import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START_TIME = Date.now();
const TIME_BUDGET_MS = 300_000; // 5 minutes

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

// iTunes Search API for artist images (free, no auth needed)
const artistImageCache = new Map<string, string | null>();

async function lookupArtistImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  const cacheKey = cleanName.toLowerCase();
  if (artistImageCache.has(cacheKey)) return artistImageCache.get(cacheKey)!;

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=musicArtist&limit=1`
    );
    const data = await res.json();
    const url = data?.results?.[0]?.artworkUrl100?.replace("100x100", "600x600") || null;
    artistImageCache.set(cacheKey, url);
    return url;
  } catch {
    artistImageCache.set(cacheKey, null);
    return null;
  }
}

function getExtractionPrompt(eventCategory: string, sourceName: string): string {
  const categoryDesc = eventCategory === "comedy"
    ? "Extract ONLY stand-up comedy shows and comedy specials. EXCLUDE music concerts, theater, sports."
    : "Extract ONLY music concerts and live music performances. EXCLUDE sports, comedy, theater, conferences, exhibitions, family shows.";

  return `${categoryDesc}
Clean up artist names: remove tour names/subtitles (e.g. "Artist: TOUR NAME" → "Artist").
Normalize venue names to shortest recognizable form, remove city suffixes and sub-venues.
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
    const links = data?.data?.links || data?.links || [];
    const imageLinks = Array.isArray(links)
      ? links.filter((l: string) => /\.(jpg|jpeg|png|webp|avif)/i.test(l))
      : [];

    if (!jsonData?.events || !Array.isArray(jsonData.events)) {
      console.log(`No events extracted from ${sourceName}`);
      return [];
    }

    console.log(`Extracted ${jsonData.events.length} events from ${sourceName}`);

    return jsonData.events.map((c: any) => ({
      artist: c.artist || "Unknown",
      venue: c.venue || sourceName,
      date: c.date || new Date().toISOString(),
      ticket_url: c.ticket_url || null,
      ticket_sale_date: c.ticket_sale_date || null,
      tickets_available: c.tickets_available ?? false,
      image_url: c.image_url || imageLinks[0] || null,
      event_type: eventCategory,
      source: sourceName,
      source_url: url,
    }));
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
const normalizeVenue = (s: string) => normalize(s.split(/[,\-–—]/)[0].trim());
const dateOnly = (d: string) => {
  try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
};

function deduplicateConcerts(concerts: ScrapedConcert[]): ScrapedConcert[] {
  const seen = new Map<string, ScrapedConcert>();
  for (const c of concerts) {
    const key = `${normalizeArtist(c.artist)}|${normalizeVenue(c.venue)}|${dateOnly(c.date)}`;
    if (!seen.has(key)) {
      seen.set(key, c);
    } else {
      const existing = seen.get(key)!;
      if ((!existing.image_url && c.image_url) || (!existing.ticket_url && c.ticket_url) || (c.artist.length < existing.artist.length)) {
        seen.set(key, { ...existing, ...c, image_url: c.image_url || existing.image_url, ticket_url: c.ticket_url || existing.ticket_url });
      }
    }
  }
  return [...seen.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let targetBatch: number | null = null;
    let targetPage: number = 1;
    try {
      const body = await req.json();
      if (body?.batch) targetBatch = Number(body.batch);
      if (body?.page) targetPage = Number(body.page);
    } catch { /* no body = run all */ }

    const shouldRun = (b: number) => targetBatch === null || targetBatch === b;

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

    const allConcerts: ScrapedConcert[] = [];
    let totalUpserted = 0;

    async function upsertBatch(concerts: ScrapedConcert[]) {
      const deduped = deduplicateConcerts(concerts);
      let count = 0;
      for (const concert of deduped) {
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
      console.log(`Upserted ${count} from batch of ${concerts.length}`);
    }

    // ==================== BATCH 1: Quick high-value sources ====================
    // RA, All Things Live, Gröna Lund, Södra Teatern — single-page scrapes first
    if (shouldRun(1) && hasTimeBudget()) {
      console.log("=== BATCH 1: Priority single-page sources ===");

      const scrollActions: any[] = [];
      for (let i = 0; i < 10; i++) {
        scrollActions.push({ type: "scroll", direction: "down" });
        scrollActions.push({ type: "wait", milliseconds: 2000 });
      }

      const batch1 = await scrapeBatch([
        { name: "All Things Live Stockholm", fn: () => scrapeSource(firecrawlKey, "https://allthingslive.se/event?city=Stockholm", "All Things Live", "concert", { waitFor: 5000, onlyMainContent: false, actions: scrollActions }) },
        { name: "RA Stockholm", fn: () => scrapeSource(firecrawlKey, "https://ra.co/events/se/stockholm", "Resident Advisor", "concert", { waitFor: 10000, onlyMainContent: false }) },
        { name: "Gröna Lund", fn: () => scrapeSource(firecrawlKey, "https://www.gronalund.com/en/concerts", "Gröna Lund", "concert", { waitFor: 10000, onlyMainContent: false }) },
        { name: "Södra Teatern", fn: () => scrapeSource(firecrawlKey, "https://sodrateatern.com/", "Södra Teatern", "concert", { waitFor: 8000, onlyMainContent: false }) },
      ]);
      allConcerts.push(...batch1);
      await upsertBatch(batch1);
    }

    // ==================== BATCH 2: Cirkus (max 5 pages) ====================
    if (shouldRun(2) && hasTimeBudget()) {
      console.log("=== BATCH 2: Cirkus ===");
      const cirkusTasks = [
        { name: "Cirkus p1", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/", "Cirkus", "concert") },
        { name: "Cirkus p2", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/2/", "Cirkus", "concert") },
        { name: "Cirkus p3", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/3/", "Cirkus", "concert") },
        { name: "Cirkus p4", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/4/", "Cirkus", "concert") },
        { name: "Cirkus p5", fn: () => scrapeSource(firecrawlKey, "https://cirkus.se/sv/evenemang/page/5/", "Cirkus", "concert") },
      ];
      const batch2 = await scrapeBatch(cirkusTasks);
      allConcerts.push(...batch2);
      await upsertBatch(batch2);
    }

    // ==================== BATCH 3: Stockholm Live (3 pages) + AXS ====================
    if (shouldRun(3) && hasTimeBudget()) {
      console.log("=== BATCH 3: Stockholm Live + AXS ===");
      const batch3 = await scrapeBatch([
        { name: "Stockholm Live p1", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/", "Stockholm Live", "concert") },
        { name: "Stockholm Live p2", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/2/", "Stockholm Live", "concert") },
        { name: "Stockholm Live p3", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/3/", "Stockholm Live", "concert") },
        { name: "AXS Avicii Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/1702/avicii-arena", "AXS", "concert") },
        { name: "AXS Hovet", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/31697/hovet", "AXS", "concert") },
        { name: "AXS Strawberry Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/141684/strawberry-arena", "AXS", "concert") },
      ]);
      allConcerts.push(...batch3);
      await upsertBatch(batch3);
    }

    // ==================== BATCH 4: Ticketmaster (2 pages) ====================
    if (shouldRun(4) && hasTimeBudget()) {
      console.log("=== BATCH 4: Ticketmaster ===");
      const batch4 = await scrapeBatch([
        { name: "Ticketmaster p1", fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }) },
        { name: "Ticketmaster p2", fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=2", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }) },
      ]);
      allConcerts.push(...batch4);
      await upsertBatch(batch4);
    }

    // ==================== BATCH 5: Live Nation (10 pages) ====================
    if (shouldRun(5) && hasTimeBudget()) {
      console.log("=== BATCH 5: Live Nation ===");
      const lnPages = Array.from({ length: 10 }, (_, i) => i + 1);
      const batch5 = await scrapeBatch(
        lnPages.map((p) => ({
          name: `Live Nation p${p}`,
          fn: () => scrapeSource(firecrawlKey, `https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=${p}`, "Live Nation", "concert"),
        }))
      );
      allConcerts.push(...batch5);
      await upsertBatch(batch5);
    }

    // ==================== BATCH 6: Konserthuset (4 upcoming months) ====================
    if (shouldRun(6) && hasTimeBudget()) {
      console.log("=== BATCH 6: Konserthuset ===");
      const now = new Date();
      const months: string[] = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      const batch6 = await scrapeBatch(
        months.map((m) => ({
          name: `Konserthuset ${m}`,
          fn: () => scrapeSource(firecrawlKey, `https://www.konserthuset.se/program-och-biljetter/kalender/?month=${m}`, "Konserthuset", "concert", { waitFor: 5000 }),
        }))
      );
      allConcerts.push(...batch6);
      await upsertBatch(batch6);
    }

    // ==================== BATCH 7: Comedy ====================
    if (shouldRun(7) && hasTimeBudget()) {
      console.log("=== BATCH 7: Comedy ===");
      const batch7 = await scrapeBatch([
        { name: "Nöjesteatern", fn: () => scrapeSource(firecrawlKey, "https://www.nojesteatern.se/program/", "Nöjesteatern", "comedy") },
        { name: "Hyvens", fn: () => scrapeSource(firecrawlKey, "https://www.hyvens.se/program/", "Hyvens", "comedy") },
      ]);
      allConcerts.push(...batch7);
      await upsertBatch(batch7);
    }

    // ==================== BATCH 8: RA Stockholm additional pages ====================
    if (shouldRun(8) && hasTimeBudget()) {
      console.log("=== BATCH 8: RA Stockholm additional pages ===");
      const batch8 = await scrapeBatch(
        [2, 3].map((p) => ({
          name: `RA Stockholm p${p}`,
          fn: () => scrapeSource(firecrawlKey, `https://ra.co/events/se/stockholm?page=${p}`, "Resident Advisor", "concert", { waitFor: 10000, onlyMainContent: false }),
        }))
      );
      allConcerts.push(...batch8);
      await upsertBatch(batch8);
    }

    console.log(`Total scraped: ${allConcerts.length}, Total upserted: ${totalUpserted}`);
    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    const statusNote = !hasTimeBudget() ? " (stopped: time limit reached)" : "";
    return new Response(
      JSON.stringify({ success: true, message: `Scraped ${allConcerts.length} events, upserted ${totalUpserted} in ${elapsed}s${statusNote}` }),
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
