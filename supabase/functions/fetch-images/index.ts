// fetch-images: admin-triggered background job. Pipeline:
// 1) Trust evently /api/file/ posters  2) Spotify  3) MusicBrainz
// 4) Wikipedia  5) og:image of source_url. Skips ambiguous artists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AiClient } from "../_shared/ai.ts";
import { extractEventImageUrl, goodImageUrl, isBadImageUrl } from "../_shared/event-extract.ts";

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
  const { data } = await c.auth.getUser(auth.replace("Bearer ", ""));
  const uid = data?.user?.id;
  if (!uid) return null;
  const sb = db();
  const { data: ok } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  return ok ? uid : null;
}

async function imageReachable(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    if (/evently\.se\/api\/file\//i.test(url)) return true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { method: "HEAD", signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return true;
  } catch { /* try GET fallback */ }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { method: "GET", signal: ctl.signal, headers: { Range: "bytes=0-64" } });
    clearTimeout(t);
    return r.ok && (r.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
  } catch { return false; }
}

async function getText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "STHLMConcertsBot/2" } });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// --- Spotify ---
let SPOTIFY_TOKEN: { value: string; exp: number } | null = null;
async function spotifyToken(): Promise<string | null> {
  const id = Deno.env.get("SPOTIFY_CLIENT_ID");
  const secret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (SPOTIFY_TOKEN && SPOTIFY_TOKEN.exp > Date.now()) return SPOTIFY_TOKEN.value;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) return null;
  const d = await r.json();
  SPOTIFY_TOKEN = { value: d.access_token, exp: Date.now() + 3500_000 };
  return d.access_token;
}

async function spotifyImage(artist: string): Promise<string | null> {
  const tok = await spotifyToken();
  if (!tok) return null;
  const normalized = normalizeArtistForLookup(artist);
  const r = await fetch(
    `https://api.spotify.com/v1/search?type=artist&limit=3&q=${encodeURIComponent(normalized)}`,
    { headers: { Authorization: `Bearer ${tok}` } },
  );
  if (!r.ok) return null;
  const d = await r.json();
  const items = (d?.artists?.items ?? []) as Array<{ name: string; images?: Array<{ width: number; url: string }> }>;
  const a = items.find((x) => normalizeArtistForLookup(x.name) === normalized);
  if (!a) return null;
  const img = a.images?.find((x: { width: number; url: string }) => x.width >= 480) ?? a.images?.[0];
  return goodImageUrl(img?.url) ?? null;
}

function normalizeArtistForLookup(name: string): string {
  return name
    .replace(/\s*(\+|,| feat\.? | ft\.? | support:| w\/ ).*$/i, "")
    .replace(/\s*[-–—:|].*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// --- MusicBrainz + Wikipedia ---
async function musicbrainzMbid(artist: string): Promise<string | null> {
  const r = await fetch(
    `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=1&query=${encodeURIComponent(artist)}`,
    { headers: { "User-Agent": "STHLMConcerts/1.0 (contact: admin@sthlmconcerts.lovable.app)" } },
  );
  if (!r.ok) return null;
  const d = await r.json();
  const top = d?.artists?.[0];
  if (!top || (top.score ?? 0) < 90) return null;
  return top.id ?? null;
}

async function wikipediaImage(artist: string): Promise<string | null> {
  const r = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist)}`,
  );
  if (!r.ok) return null;
  const d = await r.json();
  const url = d?.originalimage?.source ?? d?.thumbnail?.source;
  return goodImageUrl(url);
}

// --- Disambiguation ---
async function disambiguate(ai: AiClient, artist: string): Promise<{ ok: boolean; canonical?: string }> {
  if (artist.length >= 6 && /\s/.test(artist)) return { ok: true, canonical: artist };
  try {
    const out = await ai.json<{ is_unique: boolean; canonical: string }>({
      system:
        "You decide if a short string unambiguously names a touring music or comedy act. " +
        "If common-word names ('Grave', 'Pain'), return is_unique=false. Else return canonical artist name.",
      user: `Name: ${artist}`,
      schema: {
        type: "object",
        properties: {
          is_unique: { type: "boolean" },
          canonical: { type: "string" },
        },
        required: ["is_unique", "canonical"],
        additionalProperties: false,
      },
    });
    return { ok: out.is_unique, canonical: out.canonical };
  } catch {
    return { ok: false };
  }
}

async function findImage(
  ai: AiClient,
  artist: string,
  source_url: string | null,
): Promise<string | null> {
  // 1. og:image of source_url (most reliable for Eventim, Livespot)
  if (source_url) {
    const html = await getText(source_url);
    if (html) {
      const og = extractEventImageUrl(html, source_url);
      if (og && (await imageReachable(og))) return og;
    }
  }
  // 2. Disambiguate before web/db lookup
  const dis = await disambiguate(ai, artist);
  if (!dis.ok) return null;
  const name = dis.canonical ?? artist;

  // 3. Spotify
  const sp = await spotifyImage(name);
  if (sp) return sp;

  // 4. MusicBrainz exists check + Wikipedia
  const mbid = await musicbrainzMbid(name);
  if (mbid) {
    const wp = await wikipediaImage(name);
    if (wp) return wp;
  }
  return null;
}

async function patchJob(jobId: string, patch: Record<string, unknown>) {
  await db().from("scrape_jobs").update(patch).eq("id", jobId);
}

async function runJob(jobId: string) {
  const sb = db();
  const ai = new AiClient();
  const { data: rows } = await sb
    .from("concerts")
    .select("id, artist, source_url, image_url")
    .gte("date", new Date().toISOString())
    .order("date", { ascending: true })
    .limit(1000);

  const targets = (rows ?? []).filter((r) => !r.image_url || isBadImageUrl(r.image_url));

  const total = targets.length;
  await patchJob(jobId, { status: "running", total, current_step: "fetching" });

  let updated = 0;
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    try {
      const url = await findImage(ai, c.artist, c.source_url);
      if (url) {
        await sb.from("concerts").update({ image_url: url }).eq("id", c.id);
        updated++;
      } else if (c.image_url && isBadImageUrl(c.image_url)) {
        await sb.from("concerts").update({ image_url: null }).eq("id", c.id);
      }
    } catch (_e) { /* continue */ }
    if (i % 5 === 0) {
      await patchJob(jobId, { progress: i + 1, events_upserted: updated, ai_calls: ai.usage.calls });
    }
  }
  await patchJob(jobId, {
    status: "completed",
    progress: total,
    events_upserted: updated,
    ai_calls: ai.usage.calls,
    finished_at: new Date().toISOString(),
    current_step: "done",
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
    .insert({ kind: "images", status: "queued", triggered_by: adminId })
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
