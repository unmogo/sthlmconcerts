// scrape-concerts: admin-triggered background job runner.
// Returns 202 + jobId immediately, runs in EdgeRuntime.waitUntil.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AiClient } from "../_shared/ai.ts";
import { SOURCES, fetchSource } from "../_shared/sources.ts";
import { aiResolveVenue, isValidVenue, quickResolveVenue } from "../_shared/venues.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function authedAdminUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const c = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data } = await c.auth.getClaims(auth.replace("Bearer ", ""));
  const uid = data?.claims?.sub as string | undefined;
  if (!uid) return null;
  const sb = db();
  const { data: ok } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  return ok ? uid : null;
}

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
  details: Record<string, unknown>;
}>;

async function patchJob(jobId: string, patch: JobPatch) {
  await db().from("scrape_jobs").update(patch).eq("id", jobId);
}

async function runJob(jobId: string) {
  const sb = db();
  const ai = new AiClient();
  const totals = { found: 0, upserted: 0, perSource: {} as Record<string, { found: number; upserted: number; error?: string }> };

  await patchJob(jobId, { status: "running", total: SOURCES.length });

  // Pre-load deletion blocklist (artist+date+venue lower-key)
  const { data: deleted } = await sb
    .from("deleted_concerts")
    .select("artist, venue, date");
  const blocked = new Set(
    (deleted ?? []).map((d) =>
      `${d.artist?.toLowerCase().trim()}|${d.venue?.toLowerCase().trim()}|${new Date(d.date).toISOString().slice(0, 10)}`,
    ),
  );

  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i];
    const stepStats = { found: 0, upserted: 0 };
    try {
      await patchJob(jobId, { current_step: src.name, progress: i });
      const drafts = await fetchSource(ai, src);
      stepStats.found = drafts.length;
      totals.found += drafts.length;

      for (const d of drafts) {
        if (!d.date_iso) continue;
        const date = new Date(d.date_iso);
        if (isNaN(date.getTime())) continue;
        if (date.getTime() < Date.now() - 24 * 3600_000) continue;

        // Resolve venue
        let venue = quickResolveVenue(d.venue_raw, d.address_raw);
        if (!venue) {
          venue = await aiResolveVenue(ai, d.venue_raw, d.address_raw);
        }
        if (!isValidVenue(venue)) continue;

        const key = `${d.artist.toLowerCase().trim()}|${venue!.toLowerCase().trim()}|${date.toISOString().slice(0, 10)}`;
        if (blocked.has(key)) continue;

        const ticket = d.ticket_url && !/evently\.se/i.test(d.ticket_url) ? d.ticket_url : null;

        // Upsert by source_url+date as primary dedupe key
        const row = {
          artist: d.artist.trim(),
          venue: venue!,
          date: date.toISOString(),
          ticket_url: ticket,
          tickets_available: !!ticket,
          image_url: d.image_url || null,
          source: src.source_label,
          source_url: d.source_url,
          event_type: d.event_type,
        };

        // Try update by (source_url, date), else insert.
        const { data: existing } = await sb
          .from("concerts")
          .select("id, image_url, ticket_url")
          .eq("source_url", d.source_url)
          .eq("date", row.date)
          .maybeSingle();

        if (existing) {
          await sb.from("concerts").update({
            artist: row.artist,
            venue: row.venue,
            ticket_url: row.ticket_url ?? existing.ticket_url,
            tickets_available: row.tickets_available || !!existing.ticket_url,
            image_url: row.image_url ?? existing.image_url,
            event_type: row.event_type,
            source: row.source,
          }).eq("id", existing.id);
        } else {
          const { error: insErr } = await sb.from("concerts").insert(row);
          if (insErr) continue;
        }
        stepStats.upserted++;
        totals.upserted++;
      }
    } catch (e) {
      stepStats["error" as keyof typeof stepStats] = (e as Error).message as never;
      totals.perSource[src.name] = { ...stepStats, error: (e as Error).message };
      await sb.from("scrape_log").insert({
        source: src.name,
        batch: i + 1,
        events_found: stepStats.found,
        events_upserted: stepStats.upserted,
        error: (e as Error).message.slice(0, 500),
      });
      continue;
    }
    totals.perSource[src.name] = stepStats;
    await sb.from("scrape_log").insert({
      source: src.name,
      batch: i + 1,
      events_found: stepStats.found,
      events_upserted: stepStats.upserted,
    });

    await patchJob(jobId, {
      progress: i + 1,
      events_found: totals.found,
      events_upserted: totals.upserted,
      ai_calls: ai.usage.calls,
      details: totals.perSource,
    });
  }

  await patchJob(jobId, {
    status: "completed",
    current_step: "done",
    finished_at: new Date().toISOString(),
    ai_calls: ai.usage.calls,
    events_found: totals.found,
    events_upserted: totals.upserted,
    details: totals.perSource,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const adminId = await authedAdminUserId(req);
  if (!adminId) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const sb = db();
  const { data: job, error } = await sb
    .from("scrape_jobs")
    .insert({ kind: "scrape", status: "queued", triggered_by: adminId, total: SOURCES.length })
    .select("id")
    .single();
  if (error || !job) {
    return new Response(JSON.stringify({ error: error?.message ?? "Job create failed" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  EdgeRuntime.waitUntil(
    runJob(job.id).catch(async (e) => {
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
