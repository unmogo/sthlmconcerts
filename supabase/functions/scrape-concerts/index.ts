import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START_TIME = Date.now();
const TIME_BUDGET_MS = 240_000;
const hasTimeBudget = () => Date.now() - START_TIME < TIME_BUDGET_MS;
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
  "berzelii park": "Berns",
  "berzelii park 9": "Chinateatern",
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
  // Also try address-to-venue for venue names that are actually venue names
  const fromAddress = resolveVenueFromAddress(venue);
  if (fromAddress) return fromAddress;
  return venue.replace(/,\s*(stockholm|sweden|sverige)$/i, "").trim();
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
];

// Non-Stockholm venues that should NEVER be accepted
const NON_STOCKHOLM_VENUES = [
  "malmö arena", "scandinavium", "o2 arena", "o2", "the roundhouse",
  "the pavilion", "3arena", "musikhalle", "sundsvall",
];

function isStockholmVenue(venue: string): boolean {
  const lower = venue.toLowerCase();
  if (NON_STOCKHOLM_VENUES.some(v => lower.includes(v))) return false;
  return STOCKHOLM_VENUE_KEYWORDS.some((kw) => lower.includes(kw));
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

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function extractEventlyDetailUrls(markdown: string): string[] {
  const urls = new Set<string>();

  const absoluteMatches = markdown.match(/https?:\/\/evently\.se\/en\/events\/[^\s)\]\"]+\/\d{6}-\d{4}/g) || [];
  for (const match of absoluteMatches) {
    urls.add(match.split("?")[0]);
  }

  const relativeMatches = markdown.match(/\/en\/events\/[^\s)\]\"]+\/\d{6}-\d{4}/g) || [];
  for (const match of relativeMatches) {
    urls.add(`https://evently.se${match.split("?")[0]}`);
  }

  return Array.from(urls);
}

function isInvalidVenue(venue: string): boolean {
  const lower = venue.toLowerCase().trim();
  return ["stockholm", "stockholm, sweden", "sweden", "sverige", "", "n/a", 
    "tba", "unknown", "unknown venue", "??", "arena", "stadium", "concert hall",
    "venue to be announced", "live nation"].includes(lower);
}

// ==================== FIRECRAWL ====================

async function firecrawlMap(apiKey: string, url: string, search?: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, search, limit: 5000, includeSubdomains: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) { console.error("Firecrawl map error:", data); return []; }
    return data?.links || [];
  } catch (err) {
    clearTimeout(timeout);
    console.error("Firecrawl map failed:", err);
    return [];
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
    if (!response.ok) { console.error(`Firecrawl error for ${url}:`, data); return null; }
    return data?.data?.markdown || data?.markdown || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Firecrawl fetch error for ${url}:`, err);
    return null;
  }
}

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

// ==================== EVENTLY URL PARSER ====================
// Evently detail URLs look like: /en/events/artist-name-venue/260315-1930
// Parse date from URL slug: /260315-1930 → 2026-03-15T19:30

function parseDateFromUrl(url: string): string | null {
  const slugMatch = url.match(/\/(\d{6})-(\d{4})$/);
  if (!slugMatch) return null;
  const dateStr = slugMatch[1];
  const timeStr = slugMatch[2];
  const year = 2000 + parseInt(dateStr.slice(0, 2));
  const month = parseInt(dateStr.slice(2, 4)) - 1;
  const day = parseInt(dateStr.slice(4, 6));
  const hours = parseInt(timeStr.slice(0, 2));
  const minutes = parseInt(timeStr.slice(2, 4));
  return new Date(year, month, day, hours, minutes).toISOString();
}

function parseArtistFromUrl(url: string): string | null {
  // URL: /en/events/artist-name-venue-city/260315-1930
  const match = url.match(/\/en\/events\/([^/]+)\/\d{6}-\d{4}$/);
  if (!match) return null;
  // The slug is "artist-name-venue-city-etc", take first meaningful part
  return match[1]
    .replace(/-\d{6}-\d{4}$/, "")
    .replace(/-/g, " ")
    .replace(/\s+(stockholm|sweden|sverige|biljetter|tickets)\s*/gi, "")
    .trim();
}

// ==================== PIPELINE ====================
const TOTAL_BATCHES = 10;

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

  try {
    let targetBatch = 1;
    let chain = false;
    try {
      const body = await req.json();
      if (body?.batch) targetBatch = Number(body.batch);
      if (body?.chain) chain = Boolean(body.chain);
    } catch { chain = true; }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ success: false, message: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load deleted concerts
    const { data: deletedConcerts } = await supabase.from("deleted_concerts").select("artist, venue, date");
    const deletedKeys = new Set(
      (deletedConcerts || []).map((d: any) => `${normalizeArtist(d.artist)}|${normalizeVenueKey(d.venue)}|${dateOnly(d.date)}`)
    );

    // Load existing concerts for venue matching
    const { data: existingConcerts } = await supabase
      .from("concerts")
      .select("artist, venue, date")
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

    let totalUpserted = 0;
    let totalScraped = 0;

    async function upsertEvents(events: ScrapedEvent[]) {
      let count = 0;

      for (const e of events) {
        e.venue = normalizeVenueName(e.venue);

        if (isInvalidVenue(e.venue)) continue;
        if (!isStockholmVenue(e.venue)) {
          console.log(`Rejected non-Stockholm venue: "${e.venue}" for "${e.artist}"`);
          continue;
        }

        const key = `${normalizeArtist(e.artist)}|${normalizeVenueKey(e.venue)}|${dateOnly(e.date)}`;
        if (deletedKeys.has(key)) continue;

        const dayStart = `${dateOnly(e.date)}T00:00:00Z`;
        const dayEnd = `${dateOnly(e.date)}T23:59:59Z`;

        let existingId: string | null = null;
        const { data: sameDayCandidates } = await supabase
          .from("concerts")
          .select("id, artist, venue")
          .gte("date", dayStart)
          .lt("date", dayEnd)
          .limit(100);

        const normalizedArtist = normalizeArtist(e.artist);
        const normalizedVenue = normalizeVenueKey(e.venue);
        const match = (sameDayCandidates || []).find((c: any) =>
          normalizeArtist(c.artist) === normalizedArtist && normalizeVenueKey(c.venue) === normalizedVenue
        );

        if (match?.id) {
          existingId = match.id;
        }

        if (existingId || existingKeys.has(key)) {
          if (!existingId) {
            // Key already known locally; skip noisy duplicate writes.
            continue;
          }

          const { error } = await supabase
            .from("concerts")
            .update({
              ticket_url: isValidTicketUrl(e.ticket_url) ? e.ticket_url : null,
              tickets_available: e.tickets_available ?? false,
              image_url: isValidImageUrl(e.image_url) ? e.image_url : null,
              source: e.source,
              source_url: e.source_url,
            })
            .eq("id", existingId);

          if (!error) count++;
          continue;
        }

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

    console.log(`=== Batch ${targetBatch}/${TOTAL_BATCHES} (chain=${chain}) ===`);

    // ==================== BATCH 1: EVENTLY DISCOVERY — broad URL discovery (map + deep page fallback) ====================
    if (targetBatch === 1) {
      console.log("Discovering Evently event URLs...");

      const discoverySeeds = [
        "https://evently.se/en/place/se/stockholm",
        "https://evently.se/en/place/se/stockholm?categories=music&page=1",
        "https://evently.se/en/place/se/stockholm?categories=music&page=60",
        "https://evently.se",
      ];

      const discoveredUrlSet = new Set<string>();

      for (const seed of discoverySeeds) {
        if (!hasTimeBudget()) break;
        const mapped = await firecrawlMap(firecrawlKey, seed, "/en/events/");
        for (const url of mapped) {
          if (/\/en\/events\/[^/]+\/\d{6}-\d{4}$/.test(url)) {
            discoveredUrlSet.add(url.split("?")[0]);
          }
        }
        await delay(500);
      }

      // If map returns too little (or misses deep pagination), scrape strategic pages directly.
      if (discoveredUrlSet.size < 30) {
        const fallbackPages = [1, 2, 3, 5, 10, 20, 30, 40, 50, 60, 70, 80];
        for (const page of fallbackPages) {
          if (!hasTimeBudget()) break;
          const pageUrl = `https://evently.se/en/place/se/stockholm?categories=music&page=${page}`;
          const markdown = await firecrawlScrapeMarkdown(firecrawlKey, pageUrl, 7000);
          if (!markdown) continue;

          const links = extractEventlyDetailUrls(markdown);
          for (const url of links) discoveredUrlSet.add(url);
          await delay(700);
        }
      }

      const eventUrls = Array.from(discoveredUrlSet);
      console.log(`Discovered ${eventUrls.length} Evently detail URLs`);

      // Parse date and keep future URLs only.
      const now = new Date();
      const futureUrls = eventUrls.filter((url) => {
        const parsed = parseDateFromUrl(url);
        return parsed ? new Date(parsed) > now : false;
      });

      const newUrls: string[] = [];
      for (const url of futureUrls) {
        const date = parseDateFromUrl(url);
        if (!date) continue;

        const artistSlug = parseArtistFromUrl(url) || "";
        const dayKey = `${normalize(artistSlug)}|${dateOnly(date)}`;

        const existingVenue = existingVenueMap.get(dayKey);
        if (!existingVenue) newUrls.push(url);
      }

      console.log(`${futureUrls.length} future Evently URLs, ${newUrls.length} need scraping`);

      if (newUrls.length > 0) {
        await supabase.from("scrape_log").insert({
          batch: 1,
          source: "evently-urls",
          events_found: newUrls.length,
          events_upserted: 0,
          duration_ms: Date.now() - START_TIME,
          error: JSON.stringify(newUrls),
        });
      }

      totalScraped = futureUrls.length;
    }

    // ==================== BATCH 2-3: EVENTLY DETAIL PAGES — scrape venues ====================
    if (targetBatch >= 2 && targetBatch <= 3) {
      // Load URL queue from batch 1
      const { data: logEntries } = await supabase
        .from("scrape_log")
        .select("error")
        .eq("source", "evently-urls")
        .order("created_at", { ascending: false })
        .limit(1);

      let urls: string[] = [];
      for (const entry of (logEntries || [])) {
        try { urls = JSON.parse(entry.error || "[]"); } catch {}
      }

      // Split: batch 2 takes first half, batch 3 takes second half
      const batchSize = Math.ceil(urls.length / 2);
      const start = (targetBatch - 2) * batchSize;
      const slice = urls.slice(start, start + batchSize);
      console.log(`Scraping ${slice.length} evently detail pages (batch ${targetBatch}, offset ${start})`);

      const events: ScrapedEvent[] = [];
      const unmappedAddresses: string[] = [];
      let processed = 0;

      for (const url of slice) {
        if (!hasTimeBudget()) {
          console.log(`Time budget exhausted after ${processed} pages`);
          break;
        }

        const date = parseDateFromUrl(url);
        if (!date) continue;

        const detail = await firecrawlScrapeJson(
          firecrawlKey, url, detailSchema,
          "Extract: event title/artist name, venue name (NOT 'Stockholm, Sweden' — look for the actual venue/location name), street address, ticket URL, ticket availability, image URL, and whether it's music or comedy.",
          5000
        );

        if (detail) {
          let artist = detail.event_title || parseArtistFromUrl(url) || "";
          // Clean artist name: remove date prefixes like "10/5 " and venue suffixes
          artist = artist.replace(/^\d{1,2}\/\d{1,2}\s+/, "").split(/\s*[|]\s*/)[0].trim();
          
          let venue: string | null = null;
          let eventType = "concert";
          
          if (detail.event_type === "comedy" || detail.event_type === "standup") {
            eventType = "comedy";
          }

          // Try venue_name first
          if (detail.venue_name && !isInvalidVenue(detail.venue_name)) {
            venue = normalizeVenueName(detail.venue_name);
          }
          // Try address mapping
          if (!venue && detail.address) {
            venue = resolveVenueFromAddress(detail.address);
          }
          // Try matching against DB by artist+date
          if (!venue) {
            const dayKey = `${normalizeArtist(artist)}|${dateOnly(date)}`;
            venue = existingVenueMap.get(dayKey) || null;
          }

          if (!venue && detail.address) {
            unmappedAddresses.push(`${artist}: ${detail.address} (${url})`);
          }

          if (venue && !isInvalidVenue(venue)) {
            events.push({
              artist,
              venue,
              date,
              ticket_url: detail.ticket_url || null,
              tickets_available: detail.tickets_available ?? false,
              image_url: detail.image_url || null,
              event_type: eventType,
              source: "evently",
              source_url: url,
            });
          }
        }

        processed++;
        if (processed % 5 === 0) await delay(1000); // Rate limit
      }

      if (events.length > 0) await upsertEvents(events);
      totalScraped = processed;

      if (unmappedAddresses.length > 0) {
        console.log(`UNMAPPED ADDRESSES (${unmappedAddresses.length}):\n${unmappedAddresses.slice(0, 20).join("\n")}`);
        await supabase.from("scrape_log").insert({
          batch: targetBatch,
          source: "unmapped-addresses",
          events_found: unmappedAddresses.length,
          error: JSON.stringify(unmappedAddresses),
        });
      }
    }

    // ==================== BATCH 4-5: VENUE ENRICHMENT for DB events missing venues ====================
    // This batch tries to resolve venues for events already in DB that still have invalid venues
    // (shouldn't happen after cleanup, but keeps pipeline robust)
    if (targetBatch >= 4 && targetBatch <= 5) {
      // Skip if no enrichment needed — these batches are now mainly a safety net
      console.log(`Batch ${targetBatch}: Venue enrichment safety net — checking for events needing venues`);
      
      const { data: needsVenue } = await supabase
        .from("concerts")
        .select("id, artist, venue, date, source_url")
        .gte("date", new Date().toISOString())
        .or("venue.ilike.%stockholm%sweden%,venue.eq.TBA,venue.eq.Unknown,venue.eq.N/A")
        .limit(15);

      if (!needsVenue || needsVenue.length === 0) {
        console.log("No events need venue enrichment");
      } else {
        console.log(`${needsVenue.length} events need venue enrichment`);
        for (const event of needsVenue) {
          if (!hasTimeBudget() || !event.source_url) continue;
          
          const detail = await firecrawlScrapeJson(
            firecrawlKey, event.source_url, detailSchema,
            "Extract venue name (NOT 'Stockholm, Sweden'), street address.",
            5000
          );

          let venue: string | null = null;
          if (detail?.venue_name && !isInvalidVenue(detail.venue_name)) {
            venue = normalizeVenueName(detail.venue_name);
          }
          if (!venue && detail?.address) {
            venue = resolveVenueFromAddress(detail.address);
          }

          if (venue && !isInvalidVenue(venue) && isStockholmVenue(venue)) {
            const { error } = await supabase.from("concerts")
              .update({ venue })
              .eq("id", event.id);
            if (!error) {
              console.log(`Enriched "${event.artist}": ${event.venue} → ${venue}`);
              totalUpserted++;
            }
          }
          await delay(1500);
        }
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

    // ==================== BATCH 9: COMEDY + RA ====================
    if (targetBatch === 9) {
      const sources = [
        { name: "Nöjesteatern", url: "https://www.nojesteatern.se/program/", type: "comedy" },
        { name: "Hyvens", url: "https://www.hyvens.se/program/", type: "comedy" },
        { name: "Resident Advisor", url: "https://ra.co/events/se/stockholm", type: "concert" },
      ];
      
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const prompt = src.type === "comedy" 
          ? "Extract stand-up comedy shows. Performer name, venue, date (ISO 8601, 2026), ticket URL, availability. Stockholm only."
          : "Extract music events/DJ nights in Stockholm. Artist name, venue, date (ISO 8601, 2026), ticket URL. EXCLUDE non-Stockholm.";
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

      // Final cleanup: delete any remaining invalid venue events
      console.log("Running final cleanup...");
      const { error: cleanupError } = await supabase
        .from("concerts")
        .delete()
        .or("venue.ilike.%example.com%,ticket_url.ilike.%example.com%");
      if (cleanupError) console.error("Cleanup error:", cleanupError.message);
    }

    // Log this batch
    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    await supabase.from("scrape_log").insert({
      batch: targetBatch,
      source: targetBatch === 1 ? "evently-map" : targetBatch <= 3 ? "evently-detail" : `secondary-${targetBatch}`,
      events_found: totalScraped,
      events_upserted: totalUpserted,
      duration_ms: Date.now() - START_TIME,
    });

    const message = `Batch ${targetBatch}: scraped=${totalScraped}, upserted=${totalUpserted} (${elapsed}s)`;
    console.log(message);

    if (chain) await triggerNextBatch(targetBatch, supabase);

    return new Response(JSON.stringify({ success: true, message, batch: targetBatch }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("scrape-concerts error:", err);
    return new Response(JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
