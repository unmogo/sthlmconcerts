import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START_TIME = Date.now();
const TIME_BUDGET_MS = 240_000;

function hasTimeBudget(): boolean {
  return Date.now() - START_TIME < TIME_BUDGET_MS;
}

interface ScrapedConcert {
  artist: string;
  venue: string;
  date: string;
  ticket_url?: string;
  ticket_sale_date?: string;
  tickets_available?: boolean;
  image_url?: string;
  event_type: string;
  source: string;
  source_url: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ==================== ARTIST IMAGE LOOKUP (MusicBrainz + Wikipedia) ====================
const artistImageCache = new Map<string, string | null>();

async function lookupArtistImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  const cacheKey = cleanName.toLowerCase();
  if (artistImageCache.has(cacheKey)) return artistImageCache.get(cacheKey)!;

  try {
    // Step 1: Search MusicBrainz for the artist
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(cleanName)}&limit=1&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const mbData = await mbRes.json();
    const mbArtist = mbData?.artists?.[0];
    if (!mbArtist?.id) {
      artistImageCache.set(cacheKey, null);
      return null;
    }

    // Step 2: Get artist relations (URL rels) to find Wikipedia/Wikidata
    const relRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const relData = await relRes.json();
    const relations = relData?.relations || [];

    // Try Wikidata first for a reliable image
    const wikidataRel = relations.find((r: any) => r.type === "wikidata");
    if (wikidataRel?.url?.resource) {
      const wikidataId = wikidataRel.url.resource.split("/").pop();
      const wdRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`
      );
      const wdData = await wdRes.json();
      const imageName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageName) {
        const filename = encodeURIComponent(imageName.replace(/ /g, "_"));
        const md5 = await md5Hash(imageName.replace(/ /g, "_"));
        const imageUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${filename}/500px-${filename}`;
        artistImageCache.set(cacheKey, imageUrl);
        return imageUrl;
      }
    }

    // Fallback: iTunes album art
    const itunesRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`
    );
    const itunesData = await itunesRes.json();
    const artworkUrl = itunesData?.results?.[0]?.artworkUrl100;
    if (artworkUrl) {
      const url = artworkUrl.replace("100x100", "600x600");
      artistImageCache.set(cacheKey, url);
      return url;
    }

    artistImageCache.set(cacheKey, null);
    return null;
  } catch {
    artistImageCache.set(cacheKey, null);
    return null;
  }
}

// Simple MD5 hash for Wikimedia Commons file paths
async function md5Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("MD5", data).catch(() => null);
  if (hashBuffer) {
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback: simple hash
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(32, "0");
}

// ==================== DATA QUALITY FILTERS ====================

// Venue normalization map: sub-venues → parent venue
const VENUE_NORMALIZATION: Record<string, string> = {
  "stora scen": "Gröna Lund",
  "stora scenen": "Gröna Lund",
  "lilla scenen": "Gröna Lund",
  "gröna lund stora scen": "Gröna Lund",
  "gröna lund lilla scen": "Gröna Lund",
  "friends arena": "Strawberry Arena",
  "tele2 arena": "Strawberry Arena",
};

function normalizeVenueName(venue: string): string {
  const lower = venue.toLowerCase().trim();
  for (const [key, normalized] of Object.entries(VENUE_NORMALIZATION)) {
    if (lower.includes(key)) return normalized;
  }
  // Remove city suffixes like ", Stockholm"
  return venue.replace(/,\s*(stockholm|sweden|sverige)$/i, "").trim();
}

// Stockholm venue whitelist keywords — if venue doesn't match any, flag it
const STOCKHOLM_VENUE_KEYWORDS = [
  "stockholm", "gröna lund", "grona lund", "cirkus", "globen", "avicii arena",
  "hovet", "strawberry arena", "konserthuset", "södra teatern", "sodra teatern",
  "kulturhuset", "annexet", "debaser", "berns", "nalen", "münchenbryggeriet",
  "munchenbryggeriet", "filadelfia", "fållan", "fallan", "vasateatern",
  "göta lejon", "gota lejon", "chinateatern", "rival", "scandinavium",
  "ericsson globe", "tele2", "friends arena", "stockholm live",
  "a]", "kungsträdgården", "kungstradgarden", "skansen", "grönan",
  "lilla scen", "stora scen", "sjöhistoriska", "nöjesteatern", "hyvens",
  "slaktkyrkan", "kraken", "fryshuset", "arenan", "trädgården", "tradgarden",
  "under bron", "sthlm", "kolingsborg", "skybar", "fasching", "stampen",
  "glen miller café", "jazzclub", "blå dörren", "kagelbanan",
];

function isStockholmVenue(venue: string): boolean {
  const lower = venue.toLowerCase();
  return STOCKHOLM_VENUE_KEYWORDS.some((kw) => lower.includes(kw));
}

// Invalid/dummy URL patterns
function isValidTicketUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("example.com")) return false;
  if (lower.includes("id-preview--")) return false;
  if (lower.includes("lovable.app")) return false;
  if (lower.includes("localhost")) return false;
  if (lower === "#" || lower === "/") return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ==================== EXTRACTION ====================

function getExtractionPrompt(eventCategory: string, sourceName: string): string {
  const categoryDesc = eventCategory === "comedy"
    ? "Extract ONLY stand-up comedy shows and comedy specials. EXCLUDE music concerts, theater, sports."
    : "Extract ONLY music concerts and live music performances. EXCLUDE sports, comedy, theater, conferences, exhibitions, family shows.";

  return `${categoryDesc}
Clean up artist names: remove tour names/subtitles (e.g. "Artist: TOUR NAME" → "Artist").
Normalize venue names to shortest recognizable form, remove city suffixes and sub-venues.
IMPORTANT: Only extract events happening in Stockholm, Sweden. EXCLUDE events in other cities (Malmö, Göteborg, etc.).
Current year is 2026. If no time given, use 19:00. Extract ALL events including those not yet on sale.
Source: ${sourceName}`;
}

const concertJsonSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          artist: { type: "string", description: "Clean performer/band name without tour names" },
          venue: { type: "string", description: "Normalized short venue name" },
          date: { type: "string", description: "ISO 8601 datetime" },
          ticket_url: { type: "string", description: "URL to buy tickets, or null" },
          tickets_available: { type: "boolean", description: "true if on sale" },
          image_url: { type: "string", description: "URL to artist/event image if found" },
        },
        required: ["artist", "venue", "date"],
      },
    },
  },
  required: ["events"],
};

async function scrapeSource(
  apiKey: string,
  url: string,
  sourceName: string,
  eventCategory: string,
  options?: { waitFor?: number; onlyMainContent?: boolean; actions?: any[] }
): Promise<ScrapedConcert[]> {
  console.log(`Scraping ${sourceName}: ${url}`);

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["links", "json"],
        jsonOptions: {
          schema: concertJsonSchema,
          prompt: getExtractionPrompt(eventCategory, sourceName),
        },
        onlyMainContent: options?.onlyMainContent ?? true,
        waitFor: options?.waitFor ?? 5000,
        ...(options?.actions ? { actions: options.actions } : {}),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Firecrawl error for ${sourceName}:`, data);
      return [];
    }

    const jsonData = data?.data?.json || data?.json;

    if (!jsonData?.events || !Array.isArray(jsonData.events)) {
      console.log(`No events extracted from ${sourceName}`);
      return [];
    }

    console.log(`Extracted ${jsonData.events.length} events from ${sourceName}`);

    return jsonData.events
      .map((c: any) => ({
        artist: c.artist || "Unknown",
        venue: normalizeVenueName(c.venue || sourceName),
        date: c.date || new Date().toISOString(),
        ticket_url: isValidTicketUrl(c.ticket_url) ? c.ticket_url : null,
        ticket_sale_date: c.ticket_sale_date || null,
        tickets_available: c.tickets_available ?? false,
        image_url: c.image_url || null,
        event_type: eventCategory,
        source: sourceName,
        source_url: url,
      }))
      .filter((c: ScrapedConcert) => {
        // Filter out non-Stockholm venues
        if (!isStockholmVenue(c.venue) && !isStockholmVenue(sourceName)) {
          console.log(`Filtered non-Stockholm: ${c.artist} @ ${c.venue}`);
          return false;
        }
        return true;
      });
  } catch (err) {
    console.error(`Error scraping ${sourceName}:`, err);
    return [];
  }
}

async function scrapeBatch(
  tasks: Array<{ fn: () => Promise<ScrapedConcert[]>; name: string }>,
  delayMs: number = 1500
): Promise<ScrapedConcert[]> {
  const all: ScrapedConcert[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (!hasTimeBudget()) {
      console.log(`Time budget exceeded, stopping batch at task ${i}/${tasks.length}`);
      break;
    }
    if (i > 0) await delay(delayMs);
    try {
      const result = await tasks[i].fn();
      console.log(`✓ ${tasks[i].name}: ${result.length} events`);
      all.push(...result);
    } catch (err) {
      console.error(`✗ ${tasks[i].name}: ${err}`);
    }
  }
  return all;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
const normalizeArtist = (s: string) => normalize(s.split(/[:\-–—|]/)[0].trim());
const normalizeVenueKey = (s: string) => normalize(s.split(/[,\-–—]/)[0].trim());
const dateOnly = (d: string) => {
  try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
};

function deduplicateConcerts(concerts: ScrapedConcert[]): ScrapedConcert[] {
  const seen = new Map<string, ScrapedConcert>();
  for (const c of concerts) {
    const key = `${normalizeArtist(c.artist)}|${normalizeVenueKey(c.venue)}|${dateOnly(c.date)}`;
    if (!seen.has(key)) {
      seen.set(key, c);
    } else {
      const existing = seen.get(key)!;
      // Keep the one with more complete data
      const existingScore = (existing.ticket_url ? 2 : 0) + (existing.image_url ? 1 : 0) + (existing.tickets_available ? 1 : 0);
      const newScore = (c.ticket_url ? 2 : 0) + (c.image_url ? 1 : 0) + (c.tickets_available ? 1 : 0);
      if (newScore > existingScore) {
        seen.set(key, { ...c, image_url: c.image_url || existing.image_url });
      } else {
        seen.set(key, { ...existing, image_url: existing.image_url || c.image_url, ticket_url: existing.ticket_url || c.ticket_url });
      }
    }
  }
  return [...seen.values()];
}

// Total batches: 1-17 = Live Nation (3 pages each = 51 pages), 18-24 = other sources
const TOTAL_BATCHES = 24;

function getLiveNationPages(batch: number): number[] {
  const start = (batch - 1) * 3 + 1;
  const end = Math.min(start + 2, 50);
  if (start > 50) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

async function triggerNextBatch(batch: number, supabase: any) {
  const nextBatch = batch + 1;
  if (nextBatch > TOTAL_BATCHES) {
    console.log("All batches complete — no more to chain.");
    return;
  }
  console.log(`Chaining → batch ${nextBatch} via pg_net`);
  try {
    const { error } = await supabase.rpc("trigger_scrape_batch", { batch_num: nextBatch });
    if (error) {
      console.error(`pg_net chain failed:`, error.message);
    } else {
      console.log(`Successfully queued batch ${nextBatch}`);
    }
  } catch (err) {
    console.error(`Failed to trigger next batch:`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let targetBatch: number = 1;
    let chain = false;
    let targetPage: number = 1;
    try {
      const body = await req.json();
      if (body?.batch) targetBatch = Number(body.batch);
      if (body?.chain) chain = Boolean(body.chain);
      if (body?.page) targetPage = Number(body.page);
    } catch { chain = true; }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, message: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load deleted concerts to skip them
    const { data: deletedConcerts } = await supabase
      .from("deleted_concerts")
      .select("artist, venue, date");
    const deletedKeys = new Set(
      (deletedConcerts || []).map((d: any) => 
        `${normalizeArtist(d.artist)}|${normalizeVenueKey(d.venue)}|${dateOnly(d.date)}`
      )
    );
    console.log(`Loaded ${deletedKeys.size} deleted concert keys to skip`);

    let totalUpserted = 0;

    async function upsertBatch(concerts: ScrapedConcert[]) {
      const deduped = deduplicateConcerts(concerts);
      let count = 0;
      let skippedDeleted = 0;

      for (const concert of deduped) {
        // Check if this concert was previously deleted
        const key = `${normalizeArtist(concert.artist)}|${normalizeVenueKey(concert.venue)}|${dateOnly(concert.date)}`;
        if (deletedKeys.has(key)) {
          skippedDeleted++;
          continue;
        }

        let imageUrl = concert.image_url;
        if (!imageUrl && concert.event_type !== "comedy") {
          imageUrl = await lookupArtistImage(concert.artist);
        }

        const { error } = await supabase.from("concerts").upsert(
          {
            artist: concert.artist,
            venue: concert.venue,
            date: concert.date,
            ticket_url: concert.ticket_url,
            ticket_sale_date: concert.ticket_sale_date,
            tickets_available: concert.tickets_available,
            image_url: imageUrl,
            event_type: concert.event_type,
            source: concert.source,
            source_url: concert.source_url,
          },
          { onConflict: "artist,venue,date" }
        );
        if (error) {
          console.error(`Upsert error:`, error.message);
        } else {
          count++;
        }
      }
      totalUpserted += count;
      if (skippedDeleted > 0) {
        console.log(`Skipped ${skippedDeleted} previously deleted concerts`);
      }
      console.log(`Upserted ${count} from batch of ${concerts.length}`);
    }

    console.log(`=== Running batch ${targetBatch} (chain=${chain}) ===`);
    let results: ScrapedConcert[] = [];

    // ==================== BATCHES 1-17: Live Nation (3 pages each) ====================
    if (targetBatch >= 1 && targetBatch <= 17) {
      const pages = getLiveNationPages(targetBatch);
      if (pages.length > 0) {
        console.log(`Live Nation pages ${pages[0]}-${pages[pages.length - 1]}`);
        results = await scrapeBatch(
          pages.map((p) => ({
            name: `Live Nation p${p}`,
            fn: () => scrapeSource(firecrawlKey, `https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=${p}`, "Live Nation", "concert"),
          }))
        );
      }
    }

    // ==================== BATCH 18: All Things Live + RA Stockholm ====================
    if (targetBatch === 18) {
      const scrollActions: any[] = [];
      for (let i = 0; i < 10; i++) {
        scrollActions.push({ type: "scroll", direction: "down" });
        scrollActions.push({ type: "wait", milliseconds: 2000 });
      }
      results = await scrapeBatch([
        { name: "All Things Live Stockholm", fn: () => scrapeSource(firecrawlKey, "https://allthingslive.se/event?city=Stockholm", "All Things Live", "concert", { waitFor: 5000, onlyMainContent: false, actions: scrollActions }) },
        { name: "RA Stockholm p1", fn: () => scrapeSource(firecrawlKey, "https://ra.co/events/se/stockholm", "Resident Advisor", "concert", { waitFor: 10000, onlyMainContent: false }) },
        { name: "RA Stockholm p2", fn: () => scrapeSource(firecrawlKey, "https://ra.co/events/se/stockholm?page=2", "Resident Advisor", "concert", { waitFor: 10000, onlyMainContent: false }) },
        { name: "RA Stockholm p3", fn: () => scrapeSource(firecrawlKey, "https://ra.co/events/se/stockholm?page=3", "Resident Advisor", "concert", { waitFor: 10000, onlyMainContent: false }) },
      ]);
    }

    // ==================== BATCH 19: Main Stockholm venues ====================
    if (targetBatch === 19) {
      results = await scrapeBatch([
        { name: "Cirkus p1", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/", "Cirkus", "concert") },
        { name: "Cirkus p2", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/2/", "Cirkus", "concert") },
        { name: "Cirkus p3", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/3/", "Cirkus", "concert") },
        { name: "Gröna Lund", fn: () => scrapeSource(firecrawlKey, "https://www.gronalund.com/en/concerts", "Gröna Lund", "concert", { waitFor: 10000, onlyMainContent: false }) },
        { name: "Södra Teatern", fn: () => scrapeSource(firecrawlKey, "https://sodrateatern.com/", "Södra Teatern", "concert", { waitFor: 8000, onlyMainContent: false }) },
      ]);
    }

    // ==================== BATCH 20: Stockholm Live + AXS ====================
    if (targetBatch === 20) {
      results = await scrapeBatch([
        { name: "Stockholm Live p1", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/", "Stockholm Live", "concert") },
        { name: "Stockholm Live p2", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/2/", "Stockholm Live", "concert") },
        { name: "Stockholm Live p3", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/3/", "Stockholm Live", "concert") },
        { name: "AXS Avicii Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/1702/avicii-arena", "AXS", "concert") },
        { name: "AXS Hovet", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/31697/hovet", "AXS", "concert") },
        { name: "AXS Strawberry Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/141684/strawberry-arena", "AXS", "concert") },
      ]);
    }

    // ==================== BATCH 21: Konserthuset ====================
    if (targetBatch === 21) {
      const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
      results = await scrapeBatch(
        months.map((m) => ({
          name: `Konserthuset ${m}`,
          fn: () => scrapeSource(firecrawlKey, `https://www.konserthuset.se/program-och-biljetter/kalender/?month=${m}`, "Konserthuset", "concert", { waitFor: 5000 }),
        }))
      );
    }

    // ==================== BATCH 22: Ticketmaster ====================
    if (targetBatch === 22) {
      results = await scrapeBatch([
        { name: "Ticketmaster p1", fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }) },
        { name: "Ticketmaster p2", fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=2", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }) },
        { name: "Ticketmaster p3", fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=3", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }) },
      ]);
    }

    // ==================== BATCH 23: Comedy ====================
    if (targetBatch === 23) {
      results = await scrapeBatch([
        { name: "Nöjesteatern", fn: () => scrapeSource(firecrawlKey, "https://www.nojesteatern.se/program/", "Nöjesteatern", "comedy") },
        { name: "Hyvens", fn: () => scrapeSource(firecrawlKey, "https://www.hyvens.se/program/", "Hyvens", "comedy") },
        { name: "Live Nation Comedy", fn: () => scrapeSource(firecrawlKey, "https://www.livenation.se/search?query=comedy+stockholm", "Live Nation", "comedy") },
      ]);
    }

    // ==================== BATCH 24: Kulturhuset (auto-discover) ====================
    if (targetBatch === 24) {
      let kulturhusetUrls: string[] = [];
      try {
        const listingRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://kulturhusetstadsteatern.se/konserter/", formats: ["links"], onlyMainContent: false, waitFor: 6000 }),
        });
        const listingData = await listingRes.json();
        const allLinks: string[] = listingData?.data?.links || listingData?.links || [];
        kulturhusetUrls = allLinks.filter((l: string) => l.startsWith("https://kulturhusetstadsteatern.se/konserter/") && l !== "https://kulturhusetstadsteatern.se/konserter/");
        console.log(`Kulturhuset: discovered ${kulturhusetUrls.length} concert URLs`);
      } catch (err) {
        console.error("Failed to discover Kulturhuset URLs:", err);
      }

      const { data: existingKulturhuset } = await supabase
        .from("concerts")
        .select("artist")
        .or("source.eq.Kulturhuset Stadsteatern,venue.ilike.%kulturhuset%");
      const existingArtists = new Set((existingKulturhuset || []).map((c: any) => c.artist.toLowerCase()));

      const missingUrls = kulturhusetUrls.filter((url) => {
        const slug = url.split("/").pop() || "";
        const artistGuess = slug.replace(/-/g, " ").toLowerCase();
        return ![...existingArtists].some((a) => a.includes(artistGuess) || artistGuess.includes(a));
      });

      console.log(`Kulturhuset: ${kulturhusetUrls.length} total, ${missingUrls.length} to scrape`);
      const pageSize = 4;
      const startIdx = (targetPage - 1) * pageSize;
      const pageUrls = missingUrls.slice(startIdx, startIdx + pageSize);

      results = await scrapeBatch(
        pageUrls.map((url) => ({
          name: `Kulturhuset: ${url.split("/").pop()}`,
          fn: () => scrapeSource(firecrawlKey, url, "Kulturhuset Stadsteatern", "concert", { waitFor: 5000 }),
        }))
      );
    }

    // Upsert results
    if (results.length > 0) {
      await upsertBatch(results);
    }

    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    console.log(`Batch ${targetBatch} done: ${results.length} scraped, ${totalUpserted} upserted in ${elapsed}s`);

    // Chain to next batch if requested
    if (chain) {
      await triggerNextBatch(targetBatch, supabase);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Batch ${targetBatch}/${TOTAL_BATCHES}: ${results.length} events, ${totalUpserted} upserted in ${elapsed}s`,
        batch: targetBatch,
        totalBatches: TOTAL_BATCHES,
        chain,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Scrape error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
