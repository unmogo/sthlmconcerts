import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START_TIME = Date.now();
const TIME_BUDGET_MS = 240_000; // 4 minutes (safe margin under 5-min platform limit)

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

// iTunes Search API for artist images
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

// Total batches: 1-17 = Live Nation (3 pages each = 51 pages), 18-24 = other sources
const TOTAL_BATCHES = 24;

function getLiveNationPages(batch: number): number[] {
  // Batches 1-17: LN pages 1-3, 4-6, ..., 49-51
  const start = (batch - 1) * 3 + 1;
  const end = Math.min(start + 2, 50);
  if (start > 50) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

async function triggerNextBatch(batch: number, supabaseUrl: string, anonKey: string) {
  const nextBatch = batch + 1;
  if (nextBatch > TOTAL_BATCHES) {
    console.log("All batches complete — no more to chain.");
    return;
  }
  console.log(`Chaining → batch ${nextBatch}`);
  try {
    // Fire-and-forget: don't await
    fetch(`${supabaseUrl}/functions/v1/scrape-concerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ batch: nextBatch, chain: true }),
    }).catch((err) => console.error(`Chain call failed:`, err));
    // Small delay to ensure the request is sent before we return
    await delay(500);
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
    } catch { /* no body = run batch 1 with chain */ chain = true; }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, message: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      await triggerNextBatch(targetBatch, supabaseUrl, anonKey);
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
