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
};

// Address fragments from evently detail pages → known Stockholm venues
const ADDRESS_TO_VENUE: Record<string, string> = {
  "kyrkslingan": "Tyska Kyrkan",
  "barnhusgatan 12": "Nalen",
  "djurgårdsslätten": "Gröna Lund",
  "medborgarplatsen 3": "Södra Teatern",
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
  "söder mälarstrand": "Kagelbanan",
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
  "berzelii park 9": "Chinateatern",
  "eriksdalslunden": "Eriksdalsbadet",
  "ringvägen 1": "Södra Teatern",
  "mosebacke torg": "Södra Teatern",
  "tantogatan": "Tanto",
  "tanto": "Tanto",
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
  "glen miller", "kagelbanan", "waterfront", "tanto", "eriksdal",
  "tyska kyrkan", "riddarhuset",
];

function isStockholmVenue(venue: string): boolean {
  return STOCKHOLM_VENUE_KEYWORDS.some((kw) => venue.toLowerCase().includes(kw));
}

function isValidTicketUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("example.com") || lower.includes("id-preview--") || lower.includes("lovable.app") || lower.includes("localhost")) return false;
  if (lower === "#" || lower === "/") return false;
  try { new URL(url); return true; } catch { return false; }
}

function isInvalidVenue(venue: string): boolean {
  const lower = venue.toLowerCase().trim();
  return lower === "stockholm" || lower === "stockholm, sweden" || lower === "sweden" || lower === "";
}

// ==================== EVENTLY MARKDOWN PARSER ====================
// Each card in evently markdown looks like:
// [![Title](imageUrl)\\\nCategory\\\n**Title**\\\nStockholm, Sweden\\\nDate](detailUrl)
// The detail URL always contains /en/events/ and ends with /YYMMDD-HHMM

interface EventlyCard {
  artist: string;
  date_text: string;
  detail_url: string;
  image_url: string | null;
  category: string;
}

function parseEventlyMarkdown(markdown: string): EventlyCard[] {
  const cards: EventlyCard[] = [];
  const seen = new Set<string>();

  // Strategy: find all evently detail URLs, then extract title from **bold** before each
  const lines = markdown.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Find lines ending with ](https://evently.se/en/events/...)
    const urlMatch = line.match(/\]\((https:\/\/evently\.se\/en\/events\/[^)]+)\)/);
    if (!urlMatch) continue;
    
    const detailUrl = urlMatch[1];
    if (seen.has(detailUrl)) continue;
    seen.add(detailUrl);

    // Look backwards up to 10 lines to find **Title** and image
    let artist = "";
    let imageUrl: string | null = null;
    let category = "Music";
    let dateText = "";

    // The date text is usually on the same line or just before the URL closing
    // e.g., "Mar 15 07:30 PM](url)" — extract what's before ](url) on the same line
    const dateBeforeUrl = line.match(/([A-Z][a-z]{2}\s+\d{1,2}.*?)\]\(/);
    if (dateBeforeUrl) {
      dateText = dateBeforeUrl[1].replace(/\\/g, "").trim();
    }

    for (let j = i; j >= Math.max(0, i - 10); j--) {
      // Find **Title**
      const titleMatch = lines[j].match(/\*\*(.+?)\*\*/);
      if (titleMatch && !artist) {
        artist = titleMatch[1].trim();
      }
      
      // Find image URL
      const imgMatch = lines[j].match(/\((https:\/\/evently\.se\/api\/file\/[^)]+)\)/);
      if (imgMatch && !imageUrl) {
        imageUrl = imgMatch[1];
      }

      // Find category (standalone text line like "Music\\" or "Jazz / Blues\\")
      const catMatch = lines[j].match(/^([A-Za-z][A-Za-z /&]+?)\\*$/);
      if (catMatch) {
        category = catMatch[1].trim();
      }
    }

    if (artist) {
      cards.push({ artist, date_text: dateText, detail_url: detailUrl, image_url: imageUrl, category });
    }
  }

  return cards;
}

// Parse evently date text like "Mar 15 07:30 PM" or "Apr 14 2027 07:00 PM"
function parseEventlyDate(dateText: string): string | null {
  if (!dateText) return null;
  
  // Clean up
  const clean = dateText.replace(/\\+/g, "").replace(/\s+/g, " ").trim();
  
  // Try to extract date/time from URL slug (more reliable): 260315-1930 = 2026-03-15T19:30
  // This is handled separately
  
  // Try standard date parsing
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  
  // Pattern: "Mon", "Mar 15 07:30 PM", "Apr 14 2027 07:00 PM"
  const match = clean.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    const month = months[match[1].toLowerCase()];
    const day = parseInt(match[2]);
    let year = match[3] ? parseInt(match[3]) : guessYear(month, day);
    let hours = parseInt(match[4]);
    const minutes = parseInt(match[5]);
    const ampm = match[6].toUpperCase();
    
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    
    return new Date(year, month, day, hours, minutes).toISOString();
  }
  
  return null;
}

// Parse date from evently URL slug: /260315-1930 → 2026-03-15T19:30
function parseDateFromUrl(url: string): string | null {
  const slugMatch = url.match(/\/(\d{6})-(\d{4})$/);
  if (!slugMatch) return null;
  
  const dateStr = slugMatch[1]; // e.g., "260315"
  const timeStr = slugMatch[2]; // e.g., "1930"
  
  const year = 2000 + parseInt(dateStr.slice(0, 2));
  const month = parseInt(dateStr.slice(2, 4)) - 1;
  const day = parseInt(dateStr.slice(4, 6));
  const hours = parseInt(timeStr.slice(0, 2));
  const minutes = parseInt(timeStr.slice(2, 4));
  
  return new Date(year, month, day, hours, minutes).toISOString();
}

function guessYear(month: number, day: number): number {
  const now = new Date();
  const thisYear = now.getFullYear();
  const candidate = new Date(thisYear, month, day);
  // If the date is more than 30 days in the past, it's probably next year
  if (candidate.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
    return thisYear + 1;
  }
  return thisYear;
}

// ==================== ARTIST IMAGE LOOKUP ====================
const artistImageCache = new Map<string, string | null>();

async function lookupArtistImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  const cacheKey = cleanName.toLowerCase();
  if (artistImageCache.has(cacheKey)) return artistImageCache.get(cacheKey)!;

  try {
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(cleanName)}&limit=1&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const mbData = await mbRes.json();
    const mbArtist = mbData?.artists?.[0];
    if (!mbArtist?.id) { artistImageCache.set(cacheKey, null); return null; }

    await delay(1100); // MusicBrainz rate limit: 1 req/sec

    const relRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const relData = await relRes.json();
    const wikidataRel = (relData?.relations || []).find((r: any) => r.type === "wikidata");
    
    if (wikidataRel?.url?.resource) {
      const wikidataId = wikidataRel.url.resource.split("/").pop();
      const wdRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`);
      const wdData = await wdRes.json();
      const imageName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageName) {
        const filename = encodeURIComponent(imageName.replace(/ /g, "_"));
        const encoded = new TextEncoder().encode(imageName.replace(/ /g, "_"));
        const hashBuffer = await crypto.subtle.digest("MD5", encoded).catch(() => null);
        let md5 = "";
        if (hashBuffer) {
          md5 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
        } else {
          let hash = 0;
          const str = imageName.replace(/ /g, "_");
          for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
          md5 = Math.abs(hash).toString(16).padStart(32, "0");
        }
        const imageUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${filename}/500px-${filename}`;
        artistImageCache.set(cacheKey, imageUrl);
        return imageUrl;
      }
    }

    // Fallback: iTunes
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`);
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

// ==================== FIRECRAWL ====================

async function firecrawlScrapeMarkdown(apiKey: string, url: string, waitFor = 5000, scrollCount = 0): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  
  // Build scroll actions for infinite-scroll pages
  const actions: any[] = [];
  for (let i = 0; i < scrollCount; i++) {
    actions.push({ type: "scroll", direction: "down" });
    actions.push({ type: "wait", milliseconds: 2000 });
  }
  
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: false,
        waitFor,
        ...(actions.length > 0 ? { actions } : {}),
      }),
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
      body: JSON.stringify({
        url,
        formats: ["json"],
        jsonOptions: { schema, prompt },
        onlyMainContent: true,
        waitFor,
      }),
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

// ==================== PIPELINE ====================

// Batch 1-3: Evently pages (music page 5, 10, 15 + comedy page 5, 10)
// Batch 4-5: Enrich events needing venues (detail page scraping)
// Batch 6-7: Secondary sources (venue-specific)
// Batch 8: Ticketmaster + Live Nation (top pages)
// Batch 9: Comedy secondary
// Batch 10: RA + All Things Live
const TOTAL_BATCHES = 10;

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

const detailSchema = {
  type: "object",
  properties: {
    venue_name: { type: "string", description: "Venue/location name, NOT 'Stockholm, Sweden'" },
    address: { type: "string", description: "Full street address" },
    ticket_url: { type: "string", description: "URL to buy tickets" },
    tickets_available: { type: "boolean", description: "Can tickets be purchased" },
  },
  required: ["address"],
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

    // Load existing concerts for venue matching (used in batch 1-3)
    const { data: existingConcerts } = await supabase
      .from("concerts")
      .select("artist, venue, date")
      .gte("date", new Date().toISOString());
    
    const existingVenueMap = new Map<string, string>();
    for (const c of (existingConcerts || [])) {
      if (c.venue && !isInvalidVenue(c.venue)) {
        existingVenueMap.set(`${normalizeArtist(c.artist)}|${dateOnly(c.date)}`, c.venue);
      }
    }
    console.log(`Loaded ${existingVenueMap.size} existing venues, ${deletedKeys.size} deleted keys`);

    let totalUpserted = 0;
    let totalScraped = 0;

    async function upsertEvents(events: ScrapedEvent[]) {
      let count = 0;
      for (const e of events) {
        if (isInvalidVenue(e.venue)) continue;
        const key = `${normalizeArtist(e.artist)}|${normalizeVenueKey(e.venue)}|${dateOnly(e.date)}`;
        if (deletedKeys.has(key)) continue;

        let imageUrl = e.image_url || null;
        // Skip image lookup during scrape — fetch-images handles this separately
        
        const { error } = await supabase.from("concerts").upsert({
          artist: e.artist,
          venue: e.venue,
          date: e.date,
          ticket_url: isValidTicketUrl(e.ticket_url) ? e.ticket_url : null,
          ticket_sale_date: e.ticket_sale_date || null,
          tickets_available: e.tickets_available ?? false,
          image_url: imageUrl,
          event_type: e.event_type,
          source: e.source,
          source_url: e.source_url,
        }, { onConflict: "artist,venue,date" });

        if (error) console.error(`Upsert error for "${e.artist}":`, error.message);
        else count++;
      }
      totalUpserted += count;
      console.log(`Upserted ${count}/${events.length}`);
    }

    console.log(`=== Batch ${targetBatch}/${TOTAL_BATCHES} (chain=${chain}) ===`);

    // ==================== BATCH 1-3: EVENTLY (markdown parsing, no AI credits) ====================
    if (targetBatch >= 1 && targetBatch <= 3) {
      const pageConfigs: Record<number, Array<{ url: string; type: string }>> = {
        1: [
          { url: "https://evently.se/en/place/se/stockholm?categories=music&page=5", type: "concert" },
          { url: "https://evently.se/en/place/se/stockholm?categories=standup&page=5", type: "comedy" },
        ],
        2: [
          { url: "https://evently.se/en/place/se/stockholm?categories=music&page=10", type: "concert" },
          { url: "https://evently.se/en/place/se/stockholm?categories=standup&page=10", type: "comedy" },
        ],
        3: [
          { url: "https://evently.se/en/place/se/stockholm?categories=music&page=15", type: "concert" },
        ],
      };

      const pages = pageConfigs[targetBatch] || [];
      const allEvents: ScrapedEvent[] = [];
      const needsEnrichment: any[] = [];

      for (const page of pages) {
        if (!hasTimeBudget()) break;
        console.log(`Scraping evently ${page.type} page...`);
        
        // Use 15 scrolls to load ~150+ events from infinite scroll
        const markdown = await firecrawlScrapeMarkdown(firecrawlKey, page.url, 5000, 15);

        const cards = parseEventlyMarkdown(markdown);
        console.log(`Parsed ${cards.length} cards from evently ${page.type}`);

        for (const card of cards) {
          // Parse date from URL slug (most reliable)
          const date = parseDateFromUrl(card.detail_url) || parseEventlyDate(card.date_text);
          if (!date) {
            console.log(`Could not parse date for "${card.artist}": ${card.date_text}`);
            continue;
          }

          const lookupKey = `${normalizeArtist(card.artist)}|${dateOnly(date)}`;
          const existingVenue = existingVenueMap.get(lookupKey);

          if (existingVenue) {
            allEvents.push({
              artist: card.artist,
              venue: existingVenue,
              date,
              image_url: card.image_url,
              event_type: page.type,
              source: "evently",
              source_url: card.detail_url,
            });
          } else {
            needsEnrichment.push({
              artist: card.artist,
              date,
              detail_url: card.detail_url,
              image_url: card.image_url,
              event_type: page.type,
            });
          }
        }
        await delay(2000);
      }

      if (allEvents.length > 0) await upsertEvents(allEvents);
      totalScraped = allEvents.length + needsEnrichment.length;

      // Store enrichment queue (only on batch 1, accumulate on 2-3)
      if (needsEnrichment.length > 0) {
        console.log(`${needsEnrichment.length} events need venue enrichment`);
        await supabase.from("scrape_log").insert({
          batch: targetBatch,
          source: `evently-enrich-queue-${targetBatch}`,
          events_found: needsEnrichment.length,
          events_upserted: allEvents.length,
          duration_ms: Date.now() - START_TIME,
          error: JSON.stringify(needsEnrichment),
        });
      }
    }

    // ==================== BATCH 4-5: ENRICH VENUES FROM DETAIL PAGES ====================
    if (targetBatch >= 4 && targetBatch <= 5) {
      // Load all enrichment queues from batch 1-3
      const { data: logEntries } = await supabase
        .from("scrape_log")
        .select("error")
        .like("source", "evently-enrich-queue-%")
        .order("created_at", { ascending: false })
        .limit(3);

      let queue: any[] = [];
      for (const entry of (logEntries || [])) {
        try { queue.push(...JSON.parse(entry.error || "[]")); } catch {}
      }
      // Dedupe by detail_url
      const seen = new Set<string>();
      queue = queue.filter(item => { if (seen.has(item.detail_url)) return false; seen.add(item.detail_url); return true; });

      const batchSize = 15;
      const start = (targetBatch - 4) * batchSize;
      const slice = queue.slice(start, start + batchSize);
      console.log(`Enriching ${slice.length} events (offset ${start} of ${queue.length})`);

      const enriched: ScrapedEvent[] = [];
      const unmappedAddresses: string[] = [];

      for (const item of slice) {
        if (!hasTimeBudget() || !item.detail_url) continue;
        console.log(`Enriching: ${item.artist}`);

        const detail = await firecrawlScrapeJson(
          firecrawlKey, item.detail_url, detailSchema,
          "Extract venue name (NOT 'Stockholm, Sweden'), street address, ticket URL, and ticket availability.",
          5000
        );

        let venue: string | null = null;
        if (detail) {
          if (detail.venue_name && !isInvalidVenue(detail.venue_name)) {
            venue = normalizeVenueName(detail.venue_name);
          }
          if (!venue && detail.address) {
            venue = resolveVenueFromAddress(detail.address);
          }
          if (!venue && detail.address) {
            unmappedAddresses.push(`${item.artist}: ${detail.address}`);
          }
        }

        if (venue && !isInvalidVenue(venue)) {
          enriched.push({
            artist: item.artist,
            venue,
            date: item.date,
            ticket_url: detail?.ticket_url || null,
            tickets_available: detail?.tickets_available ?? false,
            image_url: item.image_url || null,
            event_type: item.event_type,
            source: "evently",
            source_url: item.detail_url,
          });
        } else {
          console.log(`No venue resolved for "${item.artist}"`);
        }
        await delay(1500);
      }

      if (enriched.length > 0) await upsertEvents(enriched);
      totalScraped = enriched.length;

      // Log unmapped addresses for review
      if (unmappedAddresses.length > 0) {
        console.log(`UNMAPPED ADDRESSES:\n${unmappedAddresses.join("\n")}`);
        await supabase.from("scrape_log").insert({
          batch: targetBatch,
          source: "unmapped-addresses",
          events_found: unmappedAddresses.length,
          error: JSON.stringify(unmappedAddresses),
        });
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
      const prompt = "Extract ONLY music concerts. Artist name (clean, no tour subtitle), venue, date (ISO 8601), ticket URL, ticket availability. Stockholm only. Year 2025/2026.";
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

    // ==================== BATCH 7: AXS + KONSERTHUSET ====================
    if (targetBatch === 7) {
      const sources = [
        { name: "AXS Avicii Arena", url: "https://www.axs.com/se/venues/1702/avicii-arena", type: "concert" },
        { name: "AXS Hovet", url: "https://www.axs.com/se/venues/31697/hovet", type: "concert" },
        { name: "AXS Strawberry Arena", url: "https://www.axs.com/se/venues/141684/strawberry-arena", type: "concert" },
        { name: "Konserthuset", url: "https://www.konserthuset.se/program-och-biljetter/kalender/", type: "concert" },
      ];
      const prompt = "Extract music concerts/events. Artist name (clean), venue, date (ISO 8601), ticket URL, availability. Year 2025/2026.";
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
        { name: "Live Nation p3", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=3", type: "concert" },
      ];
      const prompt = "Extract ONLY music concerts in Stockholm. Artist name (clean, no tour name), venue, date (ISO 8601), ticket URL, availability. EXCLUDE non-Stockholm. Year 2025/2026.";
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

    // ==================== BATCH 9: COMEDY SECONDARY ====================
    if (targetBatch === 9) {
      const sources = [
        { name: "Nöjesteatern", url: "https://www.nojesteatern.se/program/", type: "comedy" },
        { name: "Hyvens", url: "https://www.hyvens.se/program/", type: "comedy" },
      ];
      const prompt = "Extract ONLY stand-up comedy shows. Performer name, venue, date (ISO 8601), ticket URL, availability. Stockholm only. Year 2025/2026.";
      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Comedy: ${src.name}`);
        const result = await firecrawlScrapeJson(firecrawlKey, src.url, secondarySourceSchema, prompt, 5000);
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date && !isInvalidVenue(e.venue))
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue), date: e.date,
              ticket_url: e.ticket_url || null, tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: "comedy", source: src.name, source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // ==================== BATCH 10: RA + ALL THINGS LIVE ====================
    if (targetBatch === 10) {
      const sources = [
        { name: "Resident Advisor", url: "https://ra.co/events/se/stockholm", type: "concert" },
        { name: "All Things Live", url: "https://allthingslive.se/event?city=Stockholm", type: "concert" },
      ];
      const prompt = "Extract music events/concerts in Stockholm. Artist name, venue, date (ISO 8601), ticket URL. Year 2025/2026. EXCLUDE non-Stockholm.";
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
    }

    // Log this batch
    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    await supabase.from("scrape_log").insert({
      batch: targetBatch,
      source: targetBatch <= 3 ? "evently" : `secondary-${targetBatch}`,
      events_found: totalScraped,
      events_upserted: totalUpserted,
      duration_ms: Date.now() - START_TIME,
    });

    if (chain) await triggerNextBatch(targetBatch, supabase);

    console.log(`Batch ${targetBatch} done: ${totalScraped} scraped, ${totalUpserted} upserted in ${elapsed}s`);
    return new Response(
      JSON.stringify({
        success: true,
        message: `Batch ${targetBatch}/${TOTAL_BATCHES}: ${totalScraped} scraped, ${totalUpserted} upserted in ${elapsed}s`,
        batch: targetBatch, totalBatches: TOTAL_BATCHES, chain,
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
