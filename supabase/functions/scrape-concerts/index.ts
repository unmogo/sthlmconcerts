import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIME_BUDGET_MS = 240_000;

function createTimeBudget() {
  const startTime = Date.now();
  return {
    startTime,
    hasTimeBudget: () => Date.now() - startTime < TIME_BUDGET_MS,
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ==================== NORMALIZATION ====================

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
const normalizeArtist = (s: string) => normalize(s.split(/[:\-–—|]/)[0].trim());
const normalizeVenueKey = (s: string) => normalize(s.split(/[,\-–—]/)[0].trim());
const dateOnly = (d: string) => {
  try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
};

const VENUE_NORMALIZATION: Record<string, string> = {
  "stora scen": "Gröna Lund",
  "stora scenen": "Gröna Lund",
  "lilla scenen": "Gröna Lund",
  "gröna lund stora scen": "Gröna Lund",
  "gröna lund lilla scen": "Gröna Lund",
  "friends arena": "Strawberry Arena",
  "tele2 arena": "Strawberry Arena",
  "nya cirkus": "Cirkus",
  "china teatern": "Chinateatern",
  "konserthuset - stockholm": "Konserthuset",
  "konserthuset stockholm": "Konserthuset",
  "debaser strand": "Debaser Strand",
  "debaser nova": "Debaser Nova",
};

const ADDRESS_TO_VENUE: Record<string, string> = {
  "kyrkslingan": "Tyska Kyrkan",
  "barnhusgatan 12": "Nalen",
  "barnhusgatan 14": "Nalen",
  "djurgårdsslätten": "Gröna Lund",
  "djurgårdsvägen 68": "Gröna Lund",
  "medborgarplatsen 3": "Södra Teatern",
  "mosebacke torg": "Södra Teatern",
  "ringvägen 1": "Södra Teatern",
  "berzelii park 9": "Chinateatern",
  "berzelii park": "Berns",
  "globentorget": "Avicii Arena",
  "johanneshovsvägen": "Avicii Arena",
  "arenaslingan 14": "Strawberry Arena",
  "torkel knutssonsgatan": "Münchenbryggeriet",
  "djurgårdsvägen 43": "Cirkus",
  "hötorget 8": "Konserthuset",
  "hornsgatan 75": "Debaser",
  "trädgårdsgatan": "Trädgården",
  "hammarby slussväg": "Trädgården",
  "söder mälarstrand": "Kägelbanan",
  "maria skolgata": "Fållan",
  "fryshuset": "Fryshuset",
  "slakthusområdet": "Slaktkyrkan",
  "klarabergsviadukten": "Stockholm Waterfront",
  "nils ericssonplatsen": "Stockholm Waterfront",
  "vasagatan 28": "Vasateatern",
  "kungsgatan 18": "Göta Lejon",
  "kungsgatan 63": "Fasching",
  "sergels torg": "Kulturhuset Stadsteatern",
  "drottninggatan 71": "Kulturhuset Stadsteatern",
  "stora nygatan 5": "Stampen",
  "brunnsgatan 21": "Glenn Miller Café",
  "eriksdalslunden": "Eriksdalsbadet",
  "tantogatan": "Tanto",
  "nöjesteatern": "Nöjesteatern",
  "hyvens": "Hyvens",
  "cirkus": "Cirkus",
  "fasching": "Fasching",
  "kulturhuset": "Kulturhuset Stadsteatern",
  "rival": "Hotel Rival",
  "stampen": "Stampen",
  "annexet": "Annexet",
  "hovet": "Hovet",
  "avicii arena": "Avicii Arena",
  "globen": "Avicii Arena",
  "strawberry arena": "Strawberry Arena",
  "waterfront": "Stockholm Waterfront",
  "tanto": "Tanto",
  "debaser": "Debaser",
  "debaser strand": "Debaser Strand",
  "debaser nova": "Debaser Nova",
  "nalen": "Nalen",
  "berns": "Berns",
  "södra teatern": "Södra Teatern",
  "kollektivet livet": "Kollektivet Livet",
  "lilla scen": "Gröna Lund",
  "filadelfia": "Filadelfia Convention Center",
  "folkoperan": "Folkoperan",
  "dramaten": "Dramaten",
  "chinateatern": "Chinateatern",
  "göta lejon": "Göta Lejon",
  "engelbrektskyrka": "Engelbrektskyrkan",
  "musikaliska": "Musikaliska",
  "the old smokehouse": "The Old Smokehouse",
  "börsen": "Börsen",
  "stadsgårdsterminalen": "Stadsgårdsterminalen",
  "kungsholms kyrka": "Kungsholms Kyrka",
  "riddarhuset": "Riddarhuset",
  "hallwyl": "Hallwylska Museet",
  "hörsalen": "Hörsalen",
  "lilla studion": "Lilla Studion",
  "studion": "Studion",
  "the abyss": "The Abyss",
  "kraken": "Kraken",
  "pumphuset": "Pumphuset",
  "bar brooklyn": "Bar Brooklyn",
  "slakthuset": "Slaktkyrkan",
  "kagelbanan": "Kägelbanan",
  "kägelbanan": "Kägelbanan",
  "parksnäckan": "Parksnäckan",
};

function resolveVenueFromAddress(address: string): string | null {
  const lower = address.toLowerCase();
  for (const [fragment, venue] of Object.entries(ADDRESS_TO_VENUE)) {
    if (lower.includes(fragment)) return venue;
  }
  return null;
}

function normalizeVenueName(venue: string): string {
  const lower = venue.toLowerCase().trim();
  for (const [key, normalized] of Object.entries(VENUE_NORMALIZATION)) {
    if (lower.includes(key)) return normalized;
  }
  const fromAddress = resolveVenueFromAddress(venue);
  if (fromAddress) return fromAddress;
  return venue.replace(/,\s*(stockholm|sweden|sverige)$/i, "").trim();
}

function resolveVenueFromEventlyUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // Evently URLs usually look like /en/events/<id>/<slug>/<date-time>
    const slug = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
    if (!slug) return null;

    const slugText = slug.replace(/[-_]+/g, " ");
    const candidate = normalizeVenueName(slugText);
    if (candidate && !isInvalidVenue(candidate) && isStockholmVenue(candidate)) return candidate;

    return null;
  } catch {
    return null;
  }
}

const STOCKHOLM_VENUE_KEYWORDS = [
  "stockholm", "gröna lund", "grona lund", "cirkus", "globen", "avicii arena",
  "hovet", "strawberry arena", "konserthuset", "södra teatern", "sodra teatern",
  "kulturhuset", "annexet", "debaser", "berns", "nalen", "münchenbryggeriet",
  "munchenbryggeriet", "filadelfia", "fållan", "fallan", "vasateatern",
  "göta lejon", "gota lejon", "chinateatern", "rival",
  "ericsson globe", "tele2", "friends arena", "stockholm live",
  "kungsträdgården", "skansen", "nöjesteatern", "hyvens",
  "slaktkyrkan", "kraken", "fryshuset", "trädgården", "tradgarden",
  "under bron", "sthlm", "kolingsborg", "fasching", "stampen",
  "glen miller", "kagelbanan", "kägelbanan", "waterfront", "tanto", "eriksdal",
  "tyska kyrkan", "riddarhuset", "folkoperan", "dramaten", "musikaliska",
  "engelbrektskyrka", "kollektivet livet", "banan-kompaniet", "hörsalen",
  "studion", "lilla studion", "fabrik", "förbindelsehallen",
  "allhelgonakyrkan", "stockholms stadion", "ulriksdals",
  "the old smokehouse", "börsen", "stadsgårdsterminalen", "kungsholms kyrka",
  "hallwyl", "the abyss", "pumphuset", "bar brooklyn", "parksnäckan",
  "debaser strand", "debaser nova", "lilla scen",
];

const NON_STOCKHOLM_VENUES = [
  "malmö arena", "scandinavium", "o2 arena", "o2", "the roundhouse",
  "the pavilion", "3arena", "musikhalle", "sundsvall", "göteborg",
];

function isStockholmVenue(venue: string): boolean {
  const lower = venue.toLowerCase();
  if (NON_STOCKHOLM_VENUES.some(v => lower.includes(v))) return false;
  return STOCKHOLM_VENUE_KEYWORDS.some((kw) => lower.includes(kw));
}

// Evently listing is already scoped to Stockholm, so we accept venues we don't recognize
// (but still reject obviously non-Stockholm venues and invalid placeholders).
function isEventlyVenueAllowed(venue: string): boolean {
  const lower = venue.toLowerCase();
  if (isInvalidVenue(venue)) return false;
  if (NON_STOCKHOLM_VENUES.some(v => lower.includes(v))) return false;
  return true;
}

function isValidTicketUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("example.com") || lower.includes("test.com")) return false;
  if (lower.includes("id-preview--") || lower.includes("lovable.app") || lower.includes("lovableproject.com")) return false;
  if (lower.includes("localhost") || lower.includes("127.0.0.1")) return false;
  if (lower === "#" || lower === "/" || lower.length < 10) return false;
  try { new URL(url); return true; } catch { return false; }
}

function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("example.com") || lower.includes("test.com")) return false;
  if (lower.includes("id-preview--") || lower.includes("lovable.app") || lower.includes("lovableproject.com")) return false;
  if (lower.includes("localhost") || lower.includes("127.0.0.1")) return false;
  if (lower.includes("widget-launcher.imbox.io")) return false;
  if (lower.includes("konserthuset.se/globalassets")) return false;
  if (lower.includes("evently.se/api/file")) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch { return false; }
}

function isInvalidVenue(venue: string): boolean {
  const lower = venue.toLowerCase().trim();
  return ["stockholm", "stockholm, sweden", "sweden", "sverige", "", "n/a",
    "tba", "unknown", "unknown venue", "??", "arena", "stadium", "concert hall",
    "venue to be announced", "live nation"].includes(lower);
}

// Extract venue from Evently title like "13/10 MARKO HIETALA | DEBASER NOVA"
function extractVenueFromTitle(title: string): { artist: string; venue: string | null } {
  // Pattern: "DD/MM ARTIST | VENUE" or "ARTIST | VENUE"
  const pipeMatch = title.match(/^(?:\d{1,2}\/\d{1,2}\s+)?(.+?)\s*[|]\s*(.+)$/);
  if (pipeMatch) {
    const artist = pipeMatch[1].trim();
    const venuePart = pipeMatch[2].trim();
    const resolved = resolveVenueFromAddress(venuePart) || normalizeVenueName(venuePart);
    if (resolved && !isInvalidVenue(resolved) && isStockholmVenue(resolved)) {
      return { artist, venue: resolved };
    }
    return { artist, venue: null };
  }
  // Remove date prefix
  const cleaned = title.replace(/^\d{1,2}\/\d{1,2}\s+/, "").trim();
  return { artist: cleaned, venue: null };
}

// ==================== FIRECRAWL ====================

async function firecrawlScrapeJson(apiKey: string, url: string, schema: any, prompt: string, waitFor = 5000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["json"], jsonOptions: { schema, prompt }, onlyMainContent: true, waitFor }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) { console.error(`Firecrawl error for ${url}:`, data); return null; }
    return data?.data?.json || data?.json || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Firecrawl JSON error for ${url}:`, err);
    return null;
  }
}

async function firecrawlScrapeMarkdown(apiKey: string, url: string, waitFor = 5000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) {
      console.error(`Firecrawl error for ${url}:`, data);
      return null;
    }
    return data?.data?.markdown || data?.markdown || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Firecrawl fetch error for ${url}:`, err);
    return null;
  }
}

async function firecrawlScrapeLinks(apiKey: string, url: string, waitFor = 5000): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      // `links` often contains more complete coverage than markdown when pages are long / truncated.
      body: JSON.stringify({ url, formats: ["links"], onlyMainContent: false, waitFor }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) {
      console.error(`Firecrawl links error for ${url}:`, data);
      return [];
    }
    return (data?.data?.links || data?.links || []) as string[];
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Firecrawl links fetch error for ${url}:`, err);
    return [];
  }
}

async function firecrawlMap(apiKey: string, url: string, search?: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, search, limit: 5000, includeSubdomains: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) {
      console.error("Firecrawl map error:", data);
      return [];
    }
    // Firecrawl responses sometimes nest under `data` (similar to scrape).
    return data?.links || data?.data?.links || [];
  } catch (err) {
    clearTimeout(timeout);
    console.error("Firecrawl map failed:", err);
    return [];
  }
}

// ==================== TYPES ====================

interface ScrapedEvent {
  artist: string;
  venue: string;
  date: string;
  ticket_url?: string | null;
  ticket_sale_date?: string | null;
  tickets_available?: boolean;
  image_url?: string | null;
  event_type: string;
  source: string;
  source_url: string;
}

// ==================== SCHEMAS ====================

const eventlyListingSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Full event title exactly as shown on the card" },
          date: { type: "string", description: "Event date and start time in ISO 8601, use year 2026 unless year is explicitly shown" },
          category: { type: "string", description: "Category badge text: Music, Rock, Hip hop, Comedy, Classical, Jazz, Alternative, EDM, Country, etc." },
          event_url: { type: "string", description: "Full URL (https://evently.se/en/events/...) to the event detail page" },
          image_url: { type: "string", description: "Full URL of the event card background image" },
        },
        required: ["title", "date"],
      },
    },
  },
  required: ["events"],
};

const detailSchema = {
  type: "object",
  properties: {
    event_title: { type: "string", description: "Full event title / artist name" },
    venue_name: { type: "string", description: "Venue name, NOT 'Stockholm, Sweden'" },
    address: { type: "string", description: "Full street address" },
    ticket_url: { type: "string", description: "URL to buy tickets" },
    tickets_available: { type: "boolean", description: "Can tickets be purchased now" },
    image_url: { type: "string", description: "Event/artist image URL" },
    event_type: { type: "string", description: "music, comedy, or other" },
  },
  required: ["event_title"],
};

const secondarySourceSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          artist: { type: "string", description: "Clean performer name" },
          venue: { type: "string", description: "Venue name" },
          date: { type: "string", description: "ISO 8601 datetime" },
          ticket_url: { type: "string", description: "Ticket URL" },
          tickets_available: { type: "boolean" },
          image_url: { type: "string" },
        },
        required: ["artist", "venue", "date"],
      },
    },
  },
  required: ["events"],
};

// ==================== PIPELINE ====================
const TOTAL_BATCHES = 10;

async function triggerNextBatch(batch: number, supabase: any) {
  const nextBatch = batch + 1;
  if (nextBatch > TOTAL_BATCHES) { console.log("All batches complete."); return; }
  console.log(`Chaining → batch ${nextBatch}`);
  try {
    const { error } = await supabase.rpc("trigger_scrape_batch", { batch_num: nextBatch });
    if (error) console.error(`Chain failed:`, error.message);
    else console.log(`Queued batch ${nextBatch}`);
  } catch (err) { console.error(`Failed to trigger:`, err); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { startTime, hasTimeBudget } = createTimeBudget();

  let targetBatch = 1;
  let chainRequested = false;
  let chainedAlready = false;
  let totalScraped = 0;
  let totalUpserted = 0;
  let supabase: any = null;

  // Optional debug mode: pass { debug: { urls: string[] } } in the request body
  // to trace whether specific Evently URLs are present in the needs-venue queue,
  // filtered as processed, and/or selected for processing.
  let debugUrls: string[] = [];
  const canonicalizeUrl = (raw: string) => {
    try {
      const u = new URL(raw);
      u.hash = "";
      u.search = "";
      let s = u.toString();
      if (s.endsWith("/")) s = s.slice(0, -1);
      return s;
    } catch {
      let s = String(raw || "").split("#")[0].split("?")[0];
      if (s.endsWith("/")) s = s.slice(0, -1);
      return s;
    }
  };
  const debugUrlSet = new Set<string>();
  const debugLog = (label: string, data: unknown) => {
    if (debugUrlSet.size === 0) return;
    try {
      console.log(`DEBUG:${label} ${JSON.stringify(data)}`);
    } catch {
      console.log(`DEBUG:${label}`, data);
    }
  };

  try {
    try {
      const body = await req.json();
      if (body?.batch) targetBatch = Number(body.batch);
      if (body?.chain !== undefined) chainRequested = Boolean(body.chain);
      if (Array.isArray(body?.debug?.urls)) {
        debugUrls = body.debug.urls.map((u: any) => canonicalizeUrl(String(u)));
        for (const u of debugUrls) debugUrlSet.add(u);
      }
    } catch {
      chainRequested = true;
    }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ success: false, message: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Chain early for long-running batches so the pipeline continues even if this batch hits a hard timeout.
    if (chainRequested && targetBatch >= 4) {
      await triggerNextBatch(targetBatch, supabase);
      chainedAlready = true;
    }
    // Load deleted concerts
    const { data: deletedConcerts } = await supabase.from("deleted_concerts").select("artist, venue, date");
    const deletedKeys = new Set(
      (deletedConcerts || []).map((d: any) => `${normalizeArtist(d.artist)}|${normalizeVenueKey(d.venue)}|${dateOnly(d.date)}`)
    );

    // Load existing concerts for venue matching
    const { data: existingConcerts } = await supabase
      .from("concerts")
      .select("id, artist, venue, date")
      .gte("date", new Date().toISOString());

    const existingVenueMap = new Map<string, string>();
    const existingKeys = new Set<string>();
    for (const c of (existingConcerts || [])) {
      const dayKey = `${normalizeArtist(c.artist)}|${dateOnly(c.date)}`;
      if (c.venue && !isInvalidVenue(c.venue)) {
        existingVenueMap.set(dayKey, c.venue);
      }
      existingKeys.add(`${normalizeArtist(c.artist)}|${normalizeVenueKey(c.venue)}|${dateOnly(c.date)}`);
    }
    console.log(`Loaded ${existingVenueMap.size} existing venues, ${deletedKeys.size} deleted keys`);

    totalUpserted = 0;
    totalScraped = 0;

    // Pre-build a map of existing concerts by normalized key for fast dedup
    const existingById = new Map<string, { id: string; artist: string; venue: string }>();
    for (const c of (existingConcerts || [])) {
      const key = `${normalizeArtist(c.artist)}|${normalizeVenueKey(c.venue)}|${dateOnly(c.date)}`;
      existingById.set(key, c as any);
    }

    async function upsertEvents(events: ScrapedEvent[]) {
      let count = 0;
      for (const e of events) {
        e.venue = normalizeVenueName(e.venue);

        // Evently listings are already Stockholm-scoped; allow unknown venues,
        // but still reject placeholders and known non-Stockholm venues.
        const venueOk = e.source === "evently"
          ? isEventlyVenueAllowed(e.venue)
          : (!isInvalidVenue(e.venue) && isStockholmVenue(e.venue));

        if (!venueOk) continue;

        const key = `${normalizeArtist(e.artist)}|${normalizeVenueKey(e.venue)}|${dateOnly(e.date)}`;
        if (deletedKeys.has(key)) continue;

        const existing = existingById.get(key);
        if (existing) {
          // Update existing
          const updateData: any = {};
          if (isValidTicketUrl(e.ticket_url)) updateData.ticket_url = e.ticket_url;
          if (isValidImageUrl(e.image_url)) updateData.image_url = e.image_url;
          if (e.source) updateData.source = e.source;
          if (e.source_url) updateData.source_url = e.source_url;
          updateData.tickets_available = e.tickets_available ?? false;

          const { error } = await supabase.from("concerts").update(updateData).eq("id", (existing as any).id);
          if (!error) count++;
          continue;
        }

        if (existingKeys.has(key)) continue;

        const { error } = await supabase.from("concerts").insert({
          artist: e.artist.trim(),
          venue: e.venue.trim(),
          date: e.date,
          ticket_url: isValidTicketUrl(e.ticket_url) ? e.ticket_url : null,
          ticket_sale_date: e.ticket_sale_date || null,
          tickets_available: e.tickets_available ?? false,
          image_url: isValidImageUrl(e.image_url) ? e.image_url : null,
          event_type: e.event_type,
          source: e.source,
          source_url: e.source_url,
        });

        if (error) {
          if (!error.message?.includes("duplicate key")) {
            console.error(`Insert error for "${e.artist}":`, error.message);
          }
        } else {
          count++;
          existingKeys.add(key);
        }
      }
      totalUpserted += count;
      console.log(`Upserted ${count}/${events.length}`);
    }

    console.log(`=== Batch ${targetBatch}/${TOTAL_BATCHES} (chain=${chainRequested}) ===`);

    // ==================== BATCH 1-3: EVENTLY (SINGLE PAGE=60, RESUME FROM OFFSET) ====================
    if (targetBatch >= 1 && targetBatch <= 3) {
      // Strategy:
      // Batch 1: Scrape music page=60 (all events), parse, store in scrape_log, upsert until time runs out
      // Batch 2: Resume music upserts from offset, then scrape comedy page=60
      // Batch 3: Resume any remaining comedy upserts

      const RESUME_SOURCE_MUSIC = "evently-parsed-music";
      const RESUME_SOURCE_COMEDY = "evently-parsed-comedy";
      const RESUME_SOURCE_OFFSET = "evently-resume-offset";

      // Helper: load stored parsed events from scrape_log
      async function loadStoredEvents(source: string): Promise<ScrapedEvent[]> {
        const { data } = await supabase
          .from("scrape_log")
          .select("error")
          .eq("source", source)
          .order("created_at", { ascending: false })
          .limit(1);
        if (!data?.[0]?.error) return [];
        try { return JSON.parse(data[0].error); } catch { return []; }
      }

      // Helper: load resume offset
      async function loadResumeOffset(category: string): Promise<number> {
        const { data } = await supabase
          .from("scrape_log")
          .select("events_upserted")
          .eq("source", `${RESUME_SOURCE_OFFSET}-${category}`)
          .order("created_at", { ascending: false })
          .limit(1);
        return data?.[0]?.events_upserted || 0;
      }

      // Helper: save resume offset
      async function saveResumeOffset(category: string, offset: number) {
        await supabase.from("scrape_log").insert({
          batch: targetBatch,
          source: `${RESUME_SOURCE_OFFSET}-${category}`,
          events_found: 0,
          events_upserted: offset,
        });
      }

      // Helper: scrape + parse one category, and use Firecrawl Map to capture tail events beyond markdown truncation
      async function scrapeAndParseCategory(category: "music" | "standup", storageSource: string): Promise<ScrapedEvent[]> {
        const listingBaseUrl = `https://evently.se/en/place/se/stockholm?categories=${category}`;
        // Evently loads more content when requesting a high page index; page=60 reliably returns the long list.
        const listingUrl = `${listingBaseUrl}&page=60`;

        let events: ScrapedEvent[] = [];
        let unresolved: string[] = [];

        // 1) Fast path: scrape listing markdown (often enough to upsert the near-term items).
        console.log(`Scraping ${category} listing markdown from ${listingUrl}...`);
        const md = await firecrawlScrapeMarkdown(firecrawlKey, listingUrl, 15000);
        if (md && md.length >= 100) {
          console.log(`Got ${md.length} chars of markdown for ${category}`);
          const parsed = parseEventlyMarkdown(md, category);
          events = parsed.events;
          unresolved = parsed.unresolved;
          console.log(`Parsed ${events.length} events with venues, ${unresolved.length} unresolved`);
        } else {
          console.log(`No (or too small) markdown content for ${category}`);
        }

        // 2) Safety net: scrape all links from the listing (more reliable than markdown on very long pages)
        // and queue any missing event URLs into evently-needs-venue so batches 4–10 can resolve venue + upsert.
        try {
          const listingLinks = await firecrawlScrapeLinks(firecrawlKey, listingUrl, 15000);

          const normalizeLink = (l: string) => {
            const trimmed = (l || "").trim();
            if (!trimmed) return null;
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
            if (trimmed.startsWith("/")) return `https://evently.se${trimmed}`;
            return null;
          };

          const canonicalizeEventUrl = (raw: string) => {
            try {
              const u = new URL(raw);
              u.hash = "";
              u.search = "";
              let s = u.toString();
              if (s.endsWith("/")) s = s.slice(0, -1);
              return s;
            } catch {
              let s = String(raw).split("#")[0].split("?")[0];
              if (s.endsWith("/")) s = s.slice(0, -1);
              return s;
            }
          };

          const candidateUrls = (listingLinks || [])
            .map((l) => normalizeLink(String(l)))
            .filter(Boolean)
            .map((u) => canonicalizeEventUrl(String(u))) as string[];

          const eventUrls = candidateUrls
            .filter((u) => u.includes("evently.se/en/events/"))
            .filter((u) => /\/\d{6}-\d{4}$/.test(u));

          console.log(`Evently links: extracted ${listingLinks.length} links; ${eventUrls.length} look like event URLs`);

          if (debugUrlSet.size > 0) {
            const eventUrlSet = new Set(eventUrls);
            const parsedUrlSet = new Set(events.map((e) => canonicalizeEventUrl(e.source_url)));
            const unresolvedUrlSet = new Set<string>();
            for (const raw of unresolved) {
              try {
                const obj = JSON.parse(raw);
                if (obj?.url) unresolvedUrlSet.add(canonicalizeEventUrl(String(obj.url)));
              } catch {
                // ignore
              }
            }

            debugLog(
              `evently_${category}_listing_presence`,
              debugUrls.map((u) => ({
                url: u,
                in_listing_links: eventUrlSet.has(u),
                in_parsed_with_venue: parsedUrlSet.has(u),
                in_unresolved_pre_extra: unresolvedUrlSet.has(u),
              }))
            );
          }

          const seenUrls = new Set<string>();
          for (const e of events) seenUrls.add(e.source_url);
          for (const raw of unresolved) {
            try {
              const obj = JSON.parse(raw);
              if (obj?.url) seenUrls.add(String(obj.url));
            } catch {
              // ignore
            }
          }

          const extra: string[] = [];
          for (const eventUrl of eventUrls) {
            if (seenUrls.has(eventUrl)) continue;

            // Derive a best-effort title/artist from the URL slug (venue resolved in later batches).
            const slugDateMatch = eventUrl.match(/\/(\d{6})-(\d{4})$/);
            if (!slugDateMatch) continue;

            const [_, datePart, timePart] = slugDateMatch;
            const year = "20" + datePart.substring(0, 2);
            const month = datePart.substring(2, 4);
            const day = datePart.substring(4, 6);
            const hour = timePart.substring(0, 2);
            const minute = timePart.substring(2, 4);
            const parsedDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
            if (isNaN(parsedDate.getTime()) || parsedDate < new Date()) continue;

            const slugMatch = eventUrl.match(/\/en\/events\/[^/]+\/([^/]+)\//);
            const rawSlug = slugMatch?.[1] ? decodeURIComponent(slugMatch[1]) : "event";
            const artist = rawSlug
              .replace(/[-_]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            extra.push(
              JSON.stringify({
                artist: artist.length ? artist : rawSlug,
                date: parsedDate.toISOString(),
                url: eventUrl,
                image_url: null,
                event_type: category === "standup" ? "comedy" : "concert",
              })
            );

            seenUrls.add(eventUrl);
          }

          if (extra.length > 0) {
            console.log(`Evently links: queued +${extra.length} extra items`);
            unresolved = unresolved.concat(extra);
          } else {
            console.log(`Evently links: no extra items needed`);
          }

          if (debugUrlSet.size > 0) {
            const extraUrlSet = new Set<string>();
            for (const raw of extra) {
              try {
                const obj = JSON.parse(raw);
                if (obj?.url) extraUrlSet.add(canonicalizeEventUrl(String(obj.url)));
              } catch {
                // ignore
              }
            }

            const unresolvedFinalUrlSet = new Set<string>();
            for (const raw of unresolved) {
              try {
                const obj = JSON.parse(raw);
                if (obj?.url) unresolvedFinalUrlSet.add(canonicalizeEventUrl(String(obj.url)));
              } catch {
                // ignore
              }
            }

            debugLog(
              `evently_${category}_post_extra`,
              debugUrls.map((u) => ({
                url: u,
                queued_as_extra: extraUrlSet.has(u),
                in_unresolved_final: unresolvedFinalUrlSet.has(u),
              }))
            );
          }
        } catch (e) {
          console.error("Evently links failed:", e);
        }

        // Store parsed events in scrape_log for resume
        if (events.length > 0) {
          // Split into chunks of ~300 to avoid row size limits
          const chunkSize = 300;
          for (let i = 0; i < events.length; i += chunkSize) {
            const chunk = events.slice(i, i + chunkSize);
            await supabase.from("scrape_log").insert({
              batch: targetBatch,
              source: storageSource + (i > 0 ? `-p${Math.floor(i / chunkSize)}` : ""),
              events_found: chunk.length,
              events_upserted: 0,
              error: JSON.stringify(chunk),
            });
          }
        }

        // Store unresolved for venue resolution batches (4..10)
        if (unresolved.length > 0) {
          // Split into chunks to avoid row size limits and to ensure we don't drop tail events.
          const chunkSize = 250;
          for (let i = 0; i < unresolved.length; i += chunkSize) {
            const chunk = unresolved.slice(i, i + chunkSize);
            await supabase.from("scrape_log").insert({
              batch: targetBatch,
              source: "evently-needs-venue",
              events_found: chunk.length,
              events_upserted: 0,
              error: JSON.stringify(chunk),
            });
          }
        }

        return events;
      }

      // Helper: upsert events from offset, returns new offset
      async function upsertFromOffset(events: ScrapedEvent[], offset: number, category: string): Promise<number> {
        let i = offset;
        let batchInserts: any[] = [];

        for (; i < events.length; i++) {
          if (!hasTimeBudget()) {
            console.log(`Time budget exhausted at offset ${i}/${events.length}`);
            break;
          }

          const e = events[i];
          e.venue = normalizeVenueName(e.venue);

          const venueOk =
            e.source === "evently"
              ? isEventlyVenueAllowed(e.venue)
              : !isInvalidVenue(e.venue) && isStockholmVenue(e.venue);

          if (!venueOk) continue;

          const key = `${normalizeArtist(e.artist)}|${normalizeVenueKey(e.venue)}|${dateOnly(e.date)}`;
          if (deletedKeys.has(key)) continue;

          const existing = existingById.get(key);
          if (existing) {
            const updateData: any = {};
            if (isValidTicketUrl(e.ticket_url)) updateData.ticket_url = e.ticket_url;
            if (isValidImageUrl(e.image_url)) updateData.image_url = e.image_url;
            if (e.source) updateData.source = e.source;
            if (e.source_url) updateData.source_url = e.source_url;
            updateData.tickets_available = e.tickets_available ?? false;
            await supabase.from("concerts").update(updateData).eq("id", existing.id);
            totalUpserted++;
            continue;
          }

          if (existingKeys.has(key)) continue;

          batchInserts.push({
            artist: e.artist.trim(),
            venue: e.venue.trim(),
            date: e.date,
            ticket_url: isValidTicketUrl(e.ticket_url) ? e.ticket_url : null,
            ticket_sale_date: e.ticket_sale_date || null,
            tickets_available: e.tickets_available ?? false,
            image_url: isValidImageUrl(e.image_url) ? e.image_url : null,
            event_type: e.event_type,
            source: e.source,
            source_url: e.source_url,
          });
          existingKeys.add(key);

          // Flush batch inserts every 50 rows
          if (batchInserts.length >= 50) {
            const { error } = await supabase.from("concerts").insert(batchInserts);
            if (error) {
              // Fallback: insert one by one on conflict
              for (const row of batchInserts) {
                const { error: e2 } = await supabase.from("concerts").insert(row);
                if (e2 && !e2.message?.includes("duplicate key")) {
                  console.error(`Insert error for "${row.artist}":`, e2.message);
                } else if (!e2) totalUpserted++;
              }
            } else {
              totalUpserted += batchInserts.length;
            }
            batchInserts = [];
          }
        }

        // Flush remaining
        if (batchInserts.length > 0) {
          const { error } = await supabase.from("concerts").insert(batchInserts);
          if (error) {
            for (const row of batchInserts) {
              const { error: e2 } = await supabase.from("concerts").insert(row);
              if (e2 && !e2.message?.includes("duplicate key")) {
                console.error(`Insert error for "${row.artist}":`, e2.message);
              } else if (!e2) totalUpserted++;
            }
          } else {
            totalUpserted += batchInserts.length;
          }
        }

        // Save resume offset
        await saveResumeOffset(category, i);
        console.log(`Upserted up to offset ${i}/${events.length} for ${category}`);
        return i;
      }

      // Parse Evently markdown listing format
      function parseEventlyMarkdown(md: string, category: string): { events: ScrapedEvent[]; unresolved: string[] } {
        const events: ScrapedEvent[] = [];
        const unresolved: string[] = [];

        const blockRegex = /\[!\[([^\]]*)\]\(([^)]*)\)[^\]]*\]\(([^)]+)\)/g;
        let match;
        while ((match = blockRegex.exec(md)) !== null) {
          const title = match[1].trim();
          const imageUrl = match[2].trim();
          const eventUrl = match[3].trim();

          if (!title || !eventUrl.includes("evently.se/en/events/")) continue;

          const blockStart = match.index;
          const blockEnd = blockStart + match[0].length;
          const fullBlock = md.substring(Math.max(0, blockStart - 10), Math.min(md.length, blockEnd + 200));

          // Parse date from URL slug: /260315-1930 → 2026-03-15T19:30
          let parsedDate: Date | null = null;
          const slugDateMatch = eventUrl.match(/\/(\d{6})-(\d{4})$/);
          if (slugDateMatch) {
            const [_, datePart, timePart] = slugDateMatch;
            const year = "20" + datePart.substring(0, 2);
            const month = datePart.substring(2, 4);
            const day = datePart.substring(4, 6);
            const hour = timePart.substring(0, 2);
            const minute = timePart.substring(2, 4);
            parsedDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
          }

          if (!parsedDate || isNaN(parsedDate.getTime()) || parsedDate < new Date()) continue;

          const { artist, venue: titleVenue } = extractVenueFromTitle(title);
          if (!artist || artist.length < 2) continue;

          let eventType = category === "standup" ? "comedy" : "concert";
          if (/comedy|standup|stand-up/i.test(fullBlock)) eventType = "comedy";

          let venue = titleVenue;

          if (!venue) {
            const dayKey = `${normalizeArtist(artist)}|${dateOnly(parsedDate.toISOString())}`;
            venue = existingVenueMap.get(dayKey) || null;
          }

          if (!venue) {
            const slugMatch = eventUrl.match(/\/en\/events\/[^/]+\/([^/]+)/);
            if (slugMatch) {
              const slugText = slugMatch[1].replace(/-/g, " ").toLowerCase();
              for (const [key, v] of Object.entries(ADDRESS_TO_VENUE)) {
                if (slugText.includes(key)) { venue = v; break; }
              }
            }
          }

          if (venue && isEventlyVenueAllowed(venue)) {
            events.push({
              artist,
              venue,
              date: parsedDate.toISOString(),
              ticket_url: eventUrl,
              tickets_available: true,
              image_url: isValidImageUrl(imageUrl) ? imageUrl : null,
              event_type: eventType,
              source: "evently",
              source_url: eventUrl,
            });
          } else {
            unresolved.push(
              JSON.stringify({
                artist,
                date: parsedDate.toISOString(),
                url: eventUrl,
                image_url: imageUrl || null,
                event_type: eventType,
              })
            );
          }
        }
        return { events, unresolved };
      }

      // ====== BATCH EXECUTION ======
      if (targetBatch === 1) {
        // Scrape ALL music events in one call
        const musicEvents = await scrapeAndParseCategory("music", RESUME_SOURCE_MUSIC);
        totalScraped = musicEvents.length;
        if (musicEvents.length > 0) {
          await upsertFromOffset(musicEvents, 0, "music");
        }
      } else if (targetBatch === 2) {
        // Resume music if incomplete, then scrape comedy
        let storedMusic = await loadStoredEvents(RESUME_SOURCE_MUSIC);
        // Also load overflow chunks
        for (let p = 1; p <= 10; p++) {
          const chunk = await loadStoredEvents(`${RESUME_SOURCE_MUSIC}-p${p}`);
          if (chunk.length === 0) break;
          storedMusic = storedMusic.concat(chunk);
        }
        const musicOffset = await loadResumeOffset("music");
        console.log(`Resuming music from offset ${musicOffset}/${storedMusic.length}`);

        if (musicOffset < storedMusic.length && storedMusic.length > 0) {
          totalScraped = storedMusic.length;
          await upsertFromOffset(storedMusic, musicOffset, "music");
        }

        // If time remains, scrape comedy
        if (hasTimeBudget()) {
          const comedyEvents = await scrapeAndParseCategory("standup", RESUME_SOURCE_COMEDY);
          totalScraped += comedyEvents.length;
          if (comedyEvents.length > 0) {
            await upsertFromOffset(comedyEvents, 0, "comedy");
          }
        }
      } else if (targetBatch === 3) {
        // Resume comedy if incomplete
        let storedComedy = await loadStoredEvents(RESUME_SOURCE_COMEDY);
        for (let p = 1; p <= 10; p++) {
          const chunk = await loadStoredEvents(`${RESUME_SOURCE_COMEDY}-p${p}`);
          if (chunk.length === 0) break;
          storedComedy = storedComedy.concat(chunk);
        }
        const comedyOffset = await loadResumeOffset("comedy");
        console.log(`Resuming comedy from offset ${comedyOffset}/${storedComedy.length}`);

        if (comedyOffset < storedComedy.length && storedComedy.length > 0) {
          totalScraped = storedComedy.length;
          await upsertFromOffset(storedComedy, comedyOffset, "comedy");
        }

        // Also resume any remaining music
        if (hasTimeBudget()) {
          let storedMusic = await loadStoredEvents(RESUME_SOURCE_MUSIC);
          for (let p = 1; p <= 10; p++) {
            const chunk = await loadStoredEvents(`${RESUME_SOURCE_MUSIC}-p${p}`);
            if (chunk.length === 0) break;
            storedMusic = storedMusic.concat(chunk);
          }
          const musicOffset = await loadResumeOffset("music");
          if (musicOffset < storedMusic.length && storedMusic.length > 0) {
            console.log(`Also resuming leftover music from ${musicOffset}/${storedMusic.length}`);
            await upsertFromOffset(storedMusic, musicOffset, "music");
          }
        }
      }

      console.log(`Evently batch ${targetBatch}: scraped=${totalScraped}, upserted=${totalUpserted}`);
    }

    // ==================== EVENTLY VENUE RESOLUTION (BATCH 4-10) ====================
    // Resolve venues for Evently events that were flagged because listing pages often show "Stockholm, Sweden".
    // We spread the queue across batches 4..10 so the pipeline reliably reaches the end.
    if (targetBatch >= 4) {
      // Evently venue resolution can hit time limits, so we must (a) not drop tail chunks and
      // (b) make progress across batches/invocations without reprocessing the same URLs.

      // PostgREST enforces a default max of 1000 rows per request; we must page
      // or tail URLs will fall out of the window.
      const PAGE_SIZE = 1000;
      async function fetchLogErrorsBySource(source: string, maxRows: number): Promise<string[]> {
        const out: string[] = [];
        for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
          const { data, error } = await supabase
            .from("scrape_log")
            .select("error")
            .eq("source", source)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            console.error(`Failed to fetch scrape_log(${source}) page @${offset}:`, error.message);
            break;
          }
          if (!data || data.length === 0) break;

          for (const row of data) out.push(row.error || "");

          // Stop early if we're just debugging and we already have all URLs covered.
          if (debugUrlSet.size > 0) {
            const joined = (data as any[]).map((r) => String(r.error || "")).join("\n");
            let allPresent = true;
            for (const u of debugUrlSet) {
              if (!joined.includes(u)) { allPresent = false; break; }
            }
            if (allPresent) break;
          }
        }
        return out;
      }

      const logEntryErrors = await fetchLogErrorsBySource("evently-needs-venue", 5000);
      const processedEntryErrors = await fetchLogErrorsBySource("evently-venue-processed", 2000);

      // Keep a lightweight "done" set to avoid repeatedly spending time on the same URLs.
      const processedUrls = new Set<string>();
      for (const raw of processedEntryErrors) {
        try {
          const arr = JSON.parse(raw || "[]");
          for (const u of arr || []) {
            if (typeof u === "string" && u) processedUrls.add(canonicalizeUrl(u));
          }
        } catch {
          // ignore
        }
      }

      let queued: any[] = [];
      for (const raw of logEntryErrors) {
        try {
          const parsed = JSON.parse(raw || "[]");
          const items = parsed
            .map((item: string) => {
              try {
                return JSON.parse(item);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          queued = queued.concat(items);
        } catch (e) {
          console.error("Failed to parse needs-venue entry:", e);
        }
      }

      // Deduplicate by url + skip already processed
      const seen = new Set<string>();
      queued = queued.filter((item: any) => {
        const rawUrl = String(item?.url || "");
        const url = canonicalizeUrl(rawUrl);
        if (!url) return false;

        // Normalize for consistent dedupe + processed checks
        item.url = url;

        if (processedUrls.has(url)) return false;
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });

      if (debugUrlSet.size > 0) {
        debugLog(
          "venue_resolution_queue_state",
          debugUrls.map((u) => ({
            url: u,
            in_processed: processedUrls.has(u),
            in_queue_after_dedupe: queued.some((it: any) => String(it?.url || "") === u),
          }))
        );
      }

      // CRITICAL FIX:
      // Do NOT partition by batch number; in practice only batch 4 may run reliably,
      // and partitioning strands some URLs forever (e.g. the far-future “tail” links).
      // Instead, process the whole deduped queue until the time budget runs out.
      const slice = queued
        .slice()
        .sort((a: any, b: any) => {
          const ta = Date.parse(String(a?.date || ""));
          const tb = Date.parse(String(b?.date || ""));
          if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
          if (Number.isFinite(ta)) return -1;
          if (Number.isFinite(tb)) return 1;
          return 0;
        });

      if (debugUrlSet.size > 0) {
        debugLog(
          "venue_resolution_slice_positions",
          debugUrls.map((u) => ({
            url: u,
            position_in_sorted_queue: slice.findIndex((it: any) => String(it?.url || "") === u),
            queue_length: slice.length,
          }))
        );
      }

      if (slice.length === 0) {
        console.log("Venue resolution: no queued events found");
      } else {
        console.log(`Venue resolution: ${slice.length} queued events (batch ${targetBatch})`);

        const events: ScrapedEvent[] = [];
        const urlsForEvents: string[] = [];
        let processedThisRun = 0;
        let progressed = 0;
        let errors = 0;

        const persistProcessedUrls = async (urls: string[]) => {
          if (urls.length === 0) return;
          const chunkSize = 200;
          for (let i = 0; i < urls.length; i += chunkSize) {
            const chunk = urls.slice(i, i + chunkSize);
            const { error } = await supabase.from("scrape_log").insert({
              batch: targetBatch,
              source: "evently-venue-processed",
              events_found: chunk.length,
              events_upserted: chunk.length,
              error: JSON.stringify(chunk),
            });
            if (error) console.error("Failed to persist processed URLs:", error.message);
          }
          progressed += urls.length;
        };

        for (const item of slice) {
          if (!hasTimeBudget()) {
            console.log(`Time budget exhausted after ${processedThisRun} events`);
            break;
          }
          if (!item?.url) continue;

          const isDebugUrl = debugUrlSet.has(String(item.url));
          if (isDebugUrl) {
            debugLog("venue_resolution_item_start", {
              url: item.url,
              artist: item.artist,
              date: item.date,
              event_type: item.event_type,
              image_url: item.image_url ?? null,
            });
          }

          const dayKey = `${normalizeArtist(item.artist)}|${dateOnly(item.date)}`;

          // Fast-path: resolve via URL slug or by matching existing same-day venues (no Firecrawl call).
          let venue: string | null =
            resolveVenueFromEventlyUrl(item.url) ||
            existingVenueMap.get(dayKey) ||
            null;

          if (venue && isEventlyVenueAllowed(venue)) {
            events.push({
              artist: item.artist,
              venue: normalizeVenueName(venue),
              date: item.date,
              ticket_url: item.url,
              tickets_available: true,
              image_url: isValidImageUrl(item.image_url) ? item.image_url : null,
              event_type: item.event_type || "concert",
              source: "evently",
              source_url: item.url,
            });
            urlsForEvents.push(item.url);
            if (isDebugUrl) {
              debugLog("venue_resolution_item_queued_fastpath", {
                url: item.url,
                venue: normalizeVenueName(venue),
              });
            }
          } else {
            try {
              const detail = await firecrawlScrapeJson(
                firecrawlKey,
                item.url,
                detailSchema,
                "Extract: venue name (NOT 'Stockholm, Sweden' — the actual venue/location), street address, ticket URL, ticket availability, image URL.",
                2000
              );

              if (detail) {
                if (detail.venue_name && !isInvalidVenue(detail.venue_name)) {
                  venue = normalizeVenueName(detail.venue_name);
                }
                if (!venue && detail.address) {
                  venue = resolveVenueFromAddress(detail.address);
                }
                if (!venue) {
                  venue = existingVenueMap.get(dayKey) || null;
                }

                if (venue && isEventlyVenueAllowed(venue)) {
                  events.push({
                    artist: item.artist,
                    venue: normalizeVenueName(venue),
                    date: item.date,
                    ticket_url: detail.ticket_url || item.url,
                    tickets_available: detail.tickets_available ?? true,
                    image_url: isValidImageUrl(detail.image_url)
                      ? detail.image_url
                      : isValidImageUrl(item.image_url)
                        ? item.image_url
                        : null,
                    event_type: item.event_type || "concert",
                    source: "evently",
                    source_url: item.url,
                  });
                  urlsForEvents.push(item.url);
                }
              }
            } catch (e) {
              errors++;
              console.error(`Detail scrape failed for ${item.artist}: ${e?.message || e}`);
            }
          }

          processedThisRun++;

          // Flush every 20 to persist progress even if the HTTP request is cancelled.
          while (events.length >= 20) {
            const chunkEvents = events.splice(0, 20);
            const chunkUrls = urlsForEvents.splice(0, 20);
            try {
              await upsertEvents(chunkEvents);
              await persistProcessedUrls(chunkUrls);
            } catch (e) {
              console.error(`Batch upsert failed: ${e?.message || e}`);
            }
          }

          if (processedThisRun % 8 === 0) await delay(500);
        }

        // Upsert remaining events + persist remaining processed URLs
        if (events.length > 0) {
          try {
            await upsertEvents(events);
            await persistProcessedUrls(urlsForEvents);
          } catch (e) {
            console.error(`Final upsert failed: ${e?.message || e}`);
          }
        }

        totalScraped += processedThisRun;
        console.log(
          `Venue resolution done: ${processedThisRun} processed, +${progressed} progressed, ${errors} errors`
        );
      }
    }

    // ==================== BATCH 6: VENUE-SPECIFIC SOURCES ====================
    if (targetBatch === 6) {
      const sources = [
        { name: "Cirkus", url: "https://cirkus.se/sv/evenemang/", type: "concert" },
        { name: "Södra Teatern", url: "https://sodrateatern.com/", type: "concert" },
        { name: "Gröna Lund", url: "https://www.gronalund.com/en/concerts", type: "concert" },
        { name: "Stockholm Live", url: "https://stockholmlive.com/evenemang/", type: "concert" },
      ];
      const prompt = "Extract ONLY music concerts. Artist name (clean, no tour subtitle), venue, date (ISO 8601, assume year 2026 if not specified), ticket URL, ticket availability. Stockholm only.";
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 8000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date, ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type, source: src.name, source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // ==================== BATCH 7: AXS + KONSERTHUSET + KULTURHUSET ====================
    if (targetBatch === 7) {
      const sources = [
        { name: "AXS Avicii Arena", url: "https://www.axs.com/se/venues/1702/avicii-arena", type: "concert" },
        { name: "AXS Hovet", url: "https://www.axs.com/se/venues/31697/hovet", type: "concert" },
        { name: "AXS Strawberry Arena", url: "https://www.axs.com/se/venues/141684/strawberry-arena", type: "concert" },
        { name: "Konserthuset", url: "https://www.konserthuset.se/program-och-biljetter/kalender/", type: "concert" },
        { name: "Kulturhuset Stadsteatern", url: "https://kulturhusetstadsteatern.se/konserter", type: "concert" },
      ];
      const prompt = "Extract music concerts/events. Artist name (clean, no subtitle or supporting acts), venue name, date (ISO 8601, assume 2026 if ambiguous), ticket URL, availability.";
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 8000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue), date: e.date,
              ticket_url: e.ticket_url || null, tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null, event_type: src.type, source: src.name, source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // ==================== BATCH 8: TICKETMASTER + LIVE NATION ====================
    if (targetBatch === 8) {
      const sources = [
        { name: "Ticketmaster", url: "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ", type: "concert" },
        { name: "Live Nation", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=1", type: "concert" },
        { name: "Live Nation p2", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=2", type: "concert" },
      ];
      const prompt = "Extract ONLY music concerts in Stockholm. Artist name (clean, no tour name), venue, date (ISO 8601, 2026), ticket URL, availability. EXCLUDE non-Stockholm events.";
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 8000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue), date: e.date,
              ticket_url: e.ticket_url || null, tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type, source: src.name.split(" p")[0], source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // ==================== BATCH 9: COMEDY + RESIDENT ADVISOR ====================
    if (targetBatch === 9) {
      // Comedy sources
      const comedySources = [
        { name: "Nöjesteatern", url: "https://www.nojesteatern.se/program/", type: "comedy" },
        { name: "Hyvens", url: "https://www.hyvens.se/program/", type: "comedy" },
      ];
      for (const src of comedySources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const prompt = "Extract stand-up comedy shows. Performer name, venue, date (ISO 8601), ticket URL, availability. Stockholm only.";
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 10000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue), date: e.date,
              ticket_url: e.ticket_url || null, tickets_available: e.tickets_available ?? false,
              image_url: isValidImageUrl(e.image_url) ? e.image_url : null,
              event_type: "comedy", source: src.name, source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }

      // Resident Advisor — scrape LISTING page with JSON extraction (not individual detail pages)
      if (hasTimeBudget()) {
        console.log("Gap-fill: Resident Advisor (listing page)");
        const raSchema = {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artist: { type: "string", description: "Main artist/DJ name or event title" },
                  venue: { type: "string", description: "Venue name" },
                  date: { type: "string", description: "Event date in ISO 8601" },
                  ticket_url: { type: "string", description: "Ticket URL or event page URL" },
                  image_url: { type: "string", description: "Event image URL" },
                },
                required: ["artist", "venue", "date"],
              },
            },
          },
          required: ["events"],
        };

        const raResult = await firecrawlScrapeJson(
          firecrawlKey,
          "https://ra.co/events/se/stockholm",
          raSchema,
          "Extract ALL music events/DJ nights listed on this page. For each: artist or event name, venue name, date (ISO 8601, 2026), ticket/event URL, image URL. Stockholm only.",
          12000
        );

        if (raResult?.events) {
          const events: ScrapedEvent[] = raResult.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: true,
              image_url: isValidImageUrl(e.image_url) ? e.image_url : null,
              event_type: "concert",
              source: "Resident Advisor",
              source_url: e.ticket_url || "https://ra.co/events/se/stockholm",
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));

          console.log(`Resident Advisor: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
      }
    }

    // ==================== BATCH 10: ALL THINGS LIVE + CLEANUP ====================
    if (targetBatch === 10) {
      const sources = [
        { name: "All Things Live", url: "https://allthingslive.se/event?city=Stockholm", type: "concert" },
      ];
      const prompt = "Extract music events/concerts in Stockholm. Artist name, venue, date (ISO 8601, 2026), ticket URL. EXCLUDE non-Stockholm.";
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 10000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue), date: e.date,
              ticket_url: e.ticket_url || null, tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type, source: src.name, source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }

      // Final cleanup
      console.log("Running final cleanup...");
      await supabase.from("concerts").delete()
        .or("venue.ilike.%example.com%,ticket_url.ilike.%example.com%");
    }

    // Chain at the end for quick batches (1-3); long batches (4+) already chained early.
    if (chainRequested && !chainedAlready) {
      await triggerNextBatch(targetBatch, supabase);
      chainedAlready = true;
    }

    // Log this batch
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    await supabase.from("scrape_log").insert({
      batch: targetBatch,
      source: targetBatch <= 3 ? "evently-listing" : targetBatch <= 5 ? "evently-detail" : `secondary-${targetBatch}`,
      events_found: totalScraped,
      events_upserted: totalUpserted,
      duration_ms: Date.now() - startTime,
    });

    const message = `Batch ${targetBatch}: scraped=${totalScraped}, upserted=${totalUpserted} (${elapsed}s)`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message, batch: targetBatch }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("scrape-concerts error:", err);

    // CRITICAL: Always chain to next batch even on error so pipeline doesn't break
    try {
      if (chainRequested && supabase && !chainedAlready) {
        console.log(`Error recovery: chaining to batch ${targetBatch + 1} despite error`);
        await triggerNextBatch(targetBatch, supabase);
        chainedAlready = true;
      }
      // Log the failed batch
      if (supabase) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase.from("scrape_log").insert({
          batch: targetBatch,
          source: targetBatch <= 3 ? "evently-listing" : targetBatch <= 5 ? "evently-detail" : `secondary-${targetBatch}`,
          events_found: totalScraped,
          events_upserted: totalUpserted,
          duration_ms: Date.now() - startTime,
          error: msg.slice(0, 500),
        });
      }
    } catch (chainErr) {
      console.error("Failed to chain/log after error:", chainErr);
    }

    return new Response(JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
