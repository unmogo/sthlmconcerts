// scrape-concerts: chunked background job runner.
//
// Reliability model (this is why events used to go missing):
//   * One SOURCE per invocation. Each invocation returns well inside the edge
//     runtime wall clock and then chains itself for the next source, so a slow
//     source (Eventim artist pages, RA pagination) can never strand the rest.
//   * A time budget is passed into every fetcher; multi-page loops stop early
//     and keep what they have instead of being killed mid-flight.
//   * A watchdog fails jobs whose heartbeat went stale, so the UI never shows a
//     job "running" forever.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AiClient } from "../_shared/ai.ts";
import { SOURCES, fetchSource } from "../_shared/sources.ts";
import { aiResolveVenue, isValidVenue, quickResolveVenue } from "../_shared/venues.ts";
import { goodImageUrl, isTicketSellerUrl, normalizeExternalUrl } from "../_shared/event-extract.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

// Per-invocation budget for source work; the runtime allows 900s, we stop far
// earlier and chain so nothing is ever cut off mid-write.
const SOURCE_BUDGET_MS = 240_000;
const STALE_AFTER_MS = 12 * 60_000;

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function bearer(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function authedAdminUserId(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const c = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await c.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const sb = db();
  const { data: ok } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  return ok ? uid : null;
}

function isServiceCall(req: Request): boolean {
  return bearer(req) === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

type SourceStats = { found: number; upserted: number; error?: string };
type JobPatch = Partial<{
  status: string;
  current_step: string;
  progress: number;
  total: number;
  events_found: number;
  events_upserted: number;
  ai_calls: number;
  error: string;
  finished_at: string;
  heartbeat_at: string;
  details: Record<string, unknown>;
}>;

async function patchJob(jobId: string, patch: JobPatch) {
  await db().from("scrape_jobs").update({ heartbeat_at: new Date().toISOString(), ...patch }).eq("id", jobId);
}

// Any job whose heartbeat stopped moving was killed by the runtime — surface it
// as failed rather than leaving a phantom "running" row.
async function reapStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const sb = db();
  await sb
    .from("scrape_jobs")
    .update({
      status: "failed",
      error: "Marked failed by watchdog: heartbeat went stale.",
      finished_at: new Date().toISOString(),
    })
    .in("status", ["running", "queued"])
    .or(`heartbeat_at.lt.${cutoff},and(heartbeat_at.is.null,started_at.lt.${cutoff})`);
}

async function blockedKeys(): Promise<Set<string>> {
  const { data } = await db().from("deleted_concerts").select("artist, venue, date");
  return new Set(
    (data ?? []).map((d) =>
      `${d.artist?.toLowerCase().trim()}|${d.venue?.toLowerCase().trim()}|${new Date(d.date).toISOString().slice(0, 10)}`,
    ),
  );
}

async function runSource(jobId: string, index: number) {
  const sb = db();
  const src = SOURCES[index];
  const ai = new AiClient();
  const stats: SourceStats = { found: 0, upserted: 0 };
  const deadline = Date.now() + SOURCE_BUDGET_MS;

  const { data: job } = await sb
    .from("scrape_jobs")
    .select("events_found, events_upserted, ai_calls, details")
    .eq("id", jobId)
    .maybeSingle();
  const priorFound = job?.events_found ?? 0;
  const priorUpserted = job?.events_upserted ?? 0;
  const priorAi = job?.ai_calls ?? 0;
  const details = (job?.details ?? {}) as Record<string, SourceStats>;

  await patchJob(jobId, {
    status: "running",
    total: SOURCES.length,
    progress: index,
    current_step: src.name,
  });

  try {
    const blocked = await blockedKeys();
    const drafts = await fetchSource(ai, src, deadline);
    stats.found = drafts.length;

    for (const d of drafts) {
      if (!d.date_iso) continue;
      const date = new Date(d.date_iso);
      if (isNaN(date.getTime())) continue;
      if (date.getTime() < Date.now() - 24 * 3600_000) continue;

      let venue = quickResolveVenue(d.venue_raw, d.address_raw);
      if (!venue && (d.venue_raw || d.address_raw)) {
        venue = await aiResolveVenue(ai, d.venue_raw, d.address_raw);
      }
      if (!isValidVenue(venue)) continue;

      const key = `${d.artist.toLowerCase().trim()}|${venue!.toLowerCase().trim()}|${date.toISOString().slice(0, 10)}`;
      if (blocked.has(key)) continue;

      const sourceUrl = normalizeExternalUrl(d.source_url);
      if (!sourceUrl) continue;
      if (isNonStockholm(sourceUrl, d.venue_raw, d.address_raw)) continue;
      const candidateTicket = normalizeExternalUrl(d.ticket_url, sourceUrl);
      const ticket = isTicketSellerUrl(candidateTicket) ? candidateTicket : null;
      const image = goodImageUrl(d.image_url);
      const description = (d.description ?? "").trim().slice(0, 1000) || null;

      const row = {
        artist: d.artist.trim(),
        venue: venue!,
        date: date.toISOString(),
        ticket_url: ticket,
        // Any working outbound link (seller or the source's own event page)
        // means the event is bookable. TBA is reserved for events with no link
        // at all or a future ticket_sale_date.
        tickets_available: true,
        image_url: image,
        description,
        source: src.source_label,
        source_url: sourceUrl,
        event_type: d.event_type,
      };


      const { data: existing } = await sb
        .from("concerts")
        .select("id, image_url, ticket_url, description")
        .eq("source_url", sourceUrl)
        .eq("date", row.date)
        .maybeSingle();

      if (existing) {
        await sb.from("concerts").update({
          artist: row.artist,
          venue: row.venue,
          ticket_url: row.ticket_url ?? existing.ticket_url,
          tickets_available: true,

          image_url: row.image_url ?? existing.image_url,
          description: row.description ?? existing.description,
          event_type: row.event_type,
          source: row.source,
        }).eq("id", existing.id);
      } else {
        const { error: insErr } = await sb.from("concerts").insert(row);
        if (insErr) continue;
      }
      stats.upserted++;
      if (stats.upserted % 10 === 0) await patchJob(jobId, { events_upserted: priorUpserted + stats.upserted });
    }
  } catch (e) {
    stats.error = (e as Error).message.slice(0, 500);
  }

  details[src.name] = stats;
  await sb.from("scrape_log").insert({
    source: src.name,
    batch: index + 1,
    events_found: stats.found,
    events_upserted: stats.upserted,
    error: stats.error ?? null,
  });

  const isLast = index >= SOURCES.length - 1;
  await patchJob(jobId, {
    progress: index + 1,
    events_found: priorFound + stats.found,
    events_upserted: priorUpserted + stats.upserted,
    ai_calls: priorAi + ai.usage.calls,
    details,
    ...(isLast
      ? { status: "completed", current_step: "done", finished_at: new Date().toISOString() }
      : {}),
  });

  if (!isLast) await chainNext(jobId, index + 1);
}

// Self-invoke for the next source so each HTTP invocation stays short-lived.
async function chainNext(jobId: string, nextIndex: number) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/scrape-concerts`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId, sourceIndex: nextIndex }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const body = await req.json().catch(() => ({})) as { jobId?: string; sourceIndex?: number };

  // Continuation call from ourselves.
  if (body.jobId && typeof body.sourceIndex === "number" && isServiceCall(req)) {
    const index = body.sourceIndex;
    if (index < 0 || index >= SOURCES.length) {
      return new Response(JSON.stringify({ error: "Bad sourceIndex" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    EdgeRuntime.waitUntil(
      runSource(body.jobId!, index).catch(async (e) => {
        await patchJob(body.jobId!, {
          status: "failed",
          error: (e as Error).message.slice(0, 1000),
          finished_at: new Date().toISOString(),
        });
      }),
    );
    return new Response(JSON.stringify({ jobId: body.jobId, sourceIndex: index, status: "running" }), {
      status: 202, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const adminId = await authedAdminUserId(req);
  if (!adminId) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  await reapStaleJobs();

  const sb = db();
  const { data: job, error } = await sb
    .from("scrape_jobs")
    .insert({
      kind: "scrape",
      status: "queued",
      triggered_by: adminId,
      total: SOURCES.length,
      heartbeat_at: new Date().toISOString(),
      details: {},
    })
    .select("id")
    .single();
  if (error || !job) {
    return new Response(JSON.stringify({ error: error?.message ?? "Job create failed" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  EdgeRuntime.waitUntil(
    runSource(job.id, 0).catch(async (e) => {
      await patchJob(job.id, {
        status: "failed",
        error: (e as Error).message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      });
    }),
  );

  return new Response(JSON.stringify({ jobId: job.id, status: "queued" }), {
    status: 202, headers: { ...cors, "Content-Type": "application/json" },
  });
});
