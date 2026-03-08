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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ==================== NORMALIZATION ====================

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
const normalizeArtist = (s: string) => normalize(s.split(/[:\-–—|]/)[0].trim());
const normalizeVenueKey = (s: string) => normalize(s.split(/[,\-–—]/)[0].trim());
const dateOnly = (d: string) => {
  try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
};

// Venue normalization: raw names → canonical
const VENUE_NORMALIZATION: Record<string, string> = {
  "stora scen": "Gröna Lund",
  "stora scenen": "Gröna Lund",
  "lilla scenen": "Gröna Lund",
  "gröna lund stora scen": "Gröna Lund",
  "gröna lund lilla scen": "Gröna Lund",
  "friends arena": "Strawberry Arena",
  "tele2 arena": "Strawberry Arena",
};

// Address fragments → known venue (for evently detail page enrichment)
const ADDRESS_TO_VENUE: Record<string, string> = {
  "kyrkslingan": "Tyska Kyrkan",
  "barnhusgatan 12-14": "Nalen",
  "djurgårdsslätten": "Gröna Lund",
  "barnhusgatan": "Nalen",
  "medborgarplatsen 3": "Södra Teatern",
  "berzelii park": "Berns",
  "globentorget": "Avicii Arena",
  "johanneshovsvägen": "Avicii Arena",
  "arenaslingan 14": "Strawberry Arena",
  "torkel knutssonsgatan 2": "Münchenbryggeriet",
  "cirkus": "Cirkus",
  "djurgårdsvägen 43": "Cirkus",
  "hötorget 8": "Konserthuset",
  "hornsgatan 75": "Debaser",
  "hornsgatan": "Debaser",
  "trädgårdsgatan": "Trädgården",
  "hammarby slussväg": "Trädgården",
  "under bron": "Under Bron",
  "söder mälarstrand": "Kagelbanan",
  "maria skolgata": "Fållan",
  "fryshuset": "Fryshuset",
  "slakthusområdet": "Slaktkyrkan",
  "arenan solna": "Strawberry Arena",
  "stora scenen gröna lund": "Gröna Lund",
  "lilla scenen gröna lund": "Gröna Lund",
  "stockholm waterfront": "Stockholm Waterfront",
  "nils ericsonsplatsen": "Stockholm Waterfront",
  "klarabergsviadukten": "Stockholm Waterfront",
  "vasagatan 28": "Vasateatern",
  "kungsgatan 18": "Göta Lejon",
  "barnängsvägen": "Fållan",
  "fasching": "Fasching",
  "kungsgatan 63": "Fasching",
  "kulturhuset": "Kulturhuset Stadsteatern",
  "sergels torg": "Kulturhuset Stadsteatern",
  "drottninggatan 71b": "Kulturhuset Stadsteatern",
  "slussen": "Kolingsborg",
  "rival": "Hotel Rival",
  "mariatorget": "Hotel Rival",
  "stampen": "Stampen",
  "stora nygatan 5": "Stampen",
  "glen miller": "Glenn Miller Café",
  "brunnsgatan 21a": "Glenn Miller Café",
  "chinateatern": "Chinateatern",
  "berzelii park 9": "Chinateatern",
  "nöjesteatern": "Nöjesteatern",
  "hyvens": "Hyvens",
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

// Stockholm venue whitelist
const STOCKHOLM_VENUE_KEYWORDS = [
  "stockholm", "gröna lund", "grona lund", "cirkus", "globen", "avicii arena",
  "hovet", "strawberry arena", "konserthuset", "södra teatern", "sodra teatern",
  "kulturhuset", "annexet", "debaser", "berns", "nalen", "münchenbryggeriet",
  "munchenbryggeriet", "filadelfia", "fållan", "fallan", "vasateatern",
  "göta lejon", "gota lejon", "chinateatern", "rival", "scandinavium",
  "ericsson globe", "tele2", "friends arena", "stockholm live",
  "kungsträdgården", "kungstradgarden", "skansen", "grönan",
  "lilla scen", "stora scen", "sjöhistoriska", "nöjesteatern", "hyvens",
  "slaktkyrkan", "kraken", "fryshuset", "arenan", "trädgården", "tradgarden",
  "under bron", "sthlm", "kolingsborg", "skybar", "fasching", "stampen",
  "glen miller", "jazzclub", "blå dörren", "kagelbanan", "waterfront",
];

function isStockholmVenue(venue: string): boolean {
  const lower = venue.toLowerCase();
  return STOCKHOLM_VENUE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isValidTicketUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("example.com") || lower.includes("id-preview--") || lower.includes("lovable.app") || lower.includes("localhost")) return false;
  if (lower === "#" || lower === "/") return false;
  try { new URL(url); return true; } catch { return false; }
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

    const relRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const relData = await relRes.json();
    const relations = relData?.relations || [];

    const wikidataRel = relations.find((r: any) => r.type === "wikidata");
    if (wikidataRel?.url?.resource) {
      const wikidataId = wikidataRel.url.resource.split("/").pop();
      const wdRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`);
      const wdData = await wdRes.json();
      const imageName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageName) {
        const filename = encodeURIComponent(imageName.replace(/ /g, "_"));
        const data = new TextEncoder().encode(imageName.replace(/ /g, "_"));
        const hashBuffer = await crypto.subtle.digest("MD5", data).catch(() => null);
        let md5 = "";
        if (hashBuffer) {
          md5 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
        } else {
          let hash = 0;
          for (let i = 0; i < imageName.length; i++) { hash = ((hash << 5) - hash) + imageName.charCodeAt(i); hash |= 0; }
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

// ==================== FIRECRAWL HELPERS ====================

const eventlyListSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          artist: { type: "string", description: "Clean performer/event name" },
          date: { type: "string", description: "ISO 8601 datetime" },
          detail_url: { type: "string", description: "Full URL to evently detail page" },
          image_url: { type: "string", description: "Image URL if present" },
          category: { type: "string", description: "Music sub-genre or 'standup'" },
        },
        required: ["artist", "date", "detail_url"],
      },
    },
  },
  required: ["events"],
};

const eventlyDetailSchema = {
  type: "object",
  properties: {
    venue_name: { type: "string", description: "Venue or location name (NOT 'Stockholm, Sweden')" },
    address: { type: "string", description: "Full street address" },
    ticket_url: { type: "string", description: "URL to buy tickets" },
    price: { type: "string", description: "Ticket price if shown" },
    tickets_available: { type: "boolean", description: "Whether tickets are available for purchase" },
    description: { type: "string", description: "Short event description" },
  },
  required: ["address"],
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
          ticket_url: { type: "string", description: "URL to buy tickets" },
          tickets_available: { type: "boolean" },
          image_url: { type: "string" },
        },
        required: ["artist", "venue", "date"],
      },
    },
  },
  required: ["events"],
};

async function firecrawlScrape(apiKey: string, url: string, schema: any, prompt: string, options?: { waitFor?: number }): Promise<any> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["json"],
      jsonOptions: { schema, prompt },
      onlyMainContent: true,
      waitFor: options?.waitFor ?? 5000,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error(`Firecrawl error for ${url}:`, data);
    return null;
  }
  return data?.data?.json || data?.json || null;
}

// ==================== PIPELINE ====================

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

// TOTAL_BATCHES: 1 = evently, 2-5 = enrich detail pages, 6-10 = secondary sources
const TOTAL_BATCHES = 10;

async function triggerNextBatch(batch: number, supabase: any) {
  const nextBatch = batch + 1;
  if (nextBatch > TOTAL_BATCHES) {
    console.log("All batches complete.");
    return;
  }
  console.log(`Chaining → batch ${nextBatch}`);
  try {
    const { error } = await supabase.rpc("trigger_scrape_batch", { batch_num: nextBatch });
    if (error) console.error(`Chain failed:`, error.message);
    else console.log(`Queued batch ${nextBatch}`);
  } catch (err) {
    console.error(`Failed to trigger next batch:`, err);
  }
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load deleted concerts to skip
    const { data: deletedConcerts } = await supabase.from("deleted_concerts").select("artist, venue, date");
    const deletedKeys = new Set(
      (deletedConcerts || []).map((d: any) => `${normalizeArtist(d.artist)}|${normalizeVenueKey(d.venue)}|${dateOnly(d.date)}`)
    );

    let totalUpserted = 0;
    let totalScraped = 0;

    async function upsertEvents(events: ScrapedEvent[]) {
      let count = 0;
      for (const e of events) {
        const key = `${normalizeArtist(e.artist)}|${normalizeVenueKey(e.venue)}|${dateOnly(e.date)}`;
        if (deletedKeys.has(key)) continue;

        // Reject "Stockholm, Sweden" as venue
        if (e.venue.toLowerCase().includes("stockholm, sweden") || e.venue.toLowerCase() === "stockholm") continue;

        let imageUrl = e.image_url || null;
        if (!imageUrl && e.event_type !== "comedy") {
          imageUrl = await lookupArtistImage(e.artist);
        }

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

        if (error) console.error(`Upsert error:`, error.message);
        else count++;
      }
      totalUpserted += count;
      console.log(`Upserted ${count}/${events.length} events`);
    }

    console.log(`=== Batch ${targetBatch} (chain=${chain}) ===`);

    // ==================== BATCH 1: EVENTLY (primary source) ====================
    if (targetBatch === 1) {
      // Load existing concerts for venue matching
      const { data: existingConcerts } = await supabase
        .from("concerts")
        .select("artist, venue, date")
        .gte("date", new Date().toISOString());

      const existingMap = new Map<string, string>();
      for (const c of (existingConcerts || [])) {
        const key = `${normalizeArtist(c.artist)}|${dateOnly(c.date)}`;
        if (c.venue && !c.venue.toLowerCase().includes("stockholm, sweden")) {
          existingMap.set(key, c.venue);
        }
      }
      console.log(`Loaded ${existingMap.size} existing concerts for venue matching`);

      const categories = [
        { url: "https://evently.se/en/place/se/stockholm?categories=music&page=60", type: "concert" },
        { url: "https://evently.se/en/place/se/stockholm?categories=standup&page=60", type: "comedy" },
      ];

      const allEvents: ScrapedEvent[] = [];
      const needsEnrichment: Array<{ artist: string; date: string; detail_url: string; image_url?: string; event_type: string }> = [];

      for (const cat of categories) {
        if (!hasTimeBudget()) break;
        console.log(`Scraping evently ${cat.type}...`);

        const prompt = cat.type === "comedy"
          ? "Extract ALL stand-up comedy events from this page. Get every card: artist/event name, date (ISO 8601, year is 2025 or 2026), and the detail page URL (starts with https://evently.se/en/events/). Also grab the image URL if present."
          : "Extract ALL music events from this page. Get every card: artist/event name, date (ISO 8601, year is 2025 or 2026), and the detail page URL (starts with https://evently.se/en/events/). Also grab the image URL if present.";

        const result = await firecrawlScrape(firecrawlKey, cat.url, eventlyListSchema, prompt, { waitFor: 8000 });
        if (!result?.events) {
          console.log(`No events extracted from evently ${cat.type}`);
          continue;
        }
        console.log(`Evently ${cat.type}: ${result.events.length} events`);

        for (const ev of result.events) {
          if (!ev.artist || !ev.date) continue;

          const artistClean = ev.artist.split(/[:\-–—|]/)[0].trim();
          const lookupKey = `${normalizeArtist(artistClean)}|${dateOnly(ev.date)}`;
          const existingVenue = existingMap.get(lookupKey);

          if (existingVenue) {
            // We have a venue from DB — upsert directly
            allEvents.push({
              artist: artistClean,
              venue: existingVenue,
              date: ev.date,
              image_url: ev.image_url || null,
              event_type: cat.type,
              source: "evently",
              source_url: ev.detail_url || cat.url,
            });
          } else {
            // Need venue enrichment — store for batch 2-5
            needsEnrichment.push({
              artist: artistClean,
              date: ev.date,
              detail_url: ev.detail_url,
              image_url: ev.image_url,
              event_type: cat.type,
            });
          }
        }
        await delay(2000);
      }

      // Upsert events that already have venues
      if (allEvents.length > 0) {
        await upsertEvents(allEvents);
      }
      totalScraped = allEvents.length + needsEnrichment.length;

      // Store enrichment queue in scrape_log for batch 2-5 to pick up
      if (needsEnrichment.length > 0) {
        console.log(`${needsEnrichment.length} events need venue enrichment`);
        const { error } = await supabase.from("scrape_log").insert({
          batch: 1,
          source: "evently-enrichment-queue",
          events_found: needsEnrichment.length,
          events_upserted: allEvents.length,
          duration_ms: Date.now() - START_TIME,
          error: JSON.stringify(needsEnrichment), // store queue in error field (reuse)
        });
        if (error) console.error("Failed to store enrichment queue:", error.message);
      }
    }

    // ==================== BATCH 2-5: ENRICH FROM DETAIL PAGES ====================
    if (targetBatch >= 2 && targetBatch <= 5) {
      // Load enrichment queue from batch 1 log
      const { data: logEntries } = await supabase
        .from("scrape_log")
        .select("error")
        .eq("source", "evently-enrichment-queue")
        .order("created_at", { ascending: false })
        .limit(1);

      let queue: any[] = [];
      try {
        queue = JSON.parse(logEntries?.[0]?.error || "[]");
      } catch { queue = []; }

      const batchSize = 10;
      const start = (targetBatch - 2) * batchSize;
      const slice = queue.slice(start, start + batchSize);
      console.log(`Enriching ${slice.length} events (${start}-${start + slice.length} of ${queue.length})`);

      const enrichedEvents: ScrapedEvent[] = [];
      for (const item of slice) {
        if (!hasTimeBudget()) break;
        if (!item.detail_url) continue;

        console.log(`Enriching: ${item.artist} — ${item.detail_url}`);
        const detail = await firecrawlScrape(
          firecrawlKey,
          item.detail_url,
          eventlyDetailSchema,
          "Extract the venue/location name (NOT 'Stockholm, Sweden'), full street address, ticket purchase URL, and whether tickets are available. If the venue name is not explicitly stated, derive it from the address or context.",
          { waitFor: 5000 }
        );

        let venue: string | null = null;
        if (detail) {
          // Try venue_name from extraction
          if (detail.venue_name && !detail.venue_name.toLowerCase().includes("stockholm, sweden")) {
            venue = normalizeVenueName(detail.venue_name);
          }
          // Try address → known venue
          if (!venue && detail.address) {
            venue = resolveVenueFromAddress(detail.address);
          }
        }

        if (venue && isStockholmVenue(venue)) {
          enrichedEvents.push({
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
          console.log(`Could not resolve venue for ${item.artist}: ${detail?.address || "no address"}`);
        }

        await delay(1500);
      }

      if (enrichedEvents.length > 0) {
        await upsertEvents(enrichedEvents);
      }
      totalScraped = enrichedEvents.length;
    }

    // ==================== BATCH 6-7: SECONDARY SOURCES (gap-fill) ====================
    if (targetBatch === 6) {
      const sources = [
        { name: "Cirkus", url: "https://cirkus.se/sv/evenemang/", type: "concert" },
        { name: "Södra Teatern", url: "https://sodrateatern.com/", type: "concert" },
        { name: "Gröna Lund", url: "https://www.gronalund.com/en/concerts", type: "concert" },
        { name: "Stockholm Live", url: "https://stockholmlive.com/evenemang/", type: "concert" },
      ];

      const prompt = "Extract ONLY music concerts. Get artist name (clean, no tour subtitle), venue name, date (ISO 8601), ticket URL, and whether tickets are on sale. Only Stockholm events. Current year is 2025/2026.";

      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrape(firecrawlKey, src.url, secondarySourceSchema, prompt, { waitFor: 8000 });
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date)
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type,
              source: src.name,
              source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    if (targetBatch === 7) {
      const sources = [
        { name: "AXS Avicii Arena", url: "https://www.axs.com/se/venues/1702/avicii-arena", type: "concert" },
        { name: "AXS Hovet", url: "https://www.axs.com/se/venues/31697/hovet", type: "concert" },
        { name: "AXS Strawberry Arena", url: "https://www.axs.com/se/venues/141684/strawberry-arena", type: "concert" },
        { name: "Konserthuset", url: "https://www.konserthuset.se/program-och-biljetter/kalender/", type: "concert" },
      ];

      const prompt = "Extract ONLY music concerts/events. Get artist name (clean), venue name, date (ISO 8601), ticket URL, and whether tickets are on sale. Current year is 2025/2026.";

      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrape(firecrawlKey, src.url, secondarySourceSchema, prompt, { waitFor: 8000 });
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date)
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type,
              source: src.name,
              source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // ==================== BATCH 8: TICKETMASTER + LIVE NATION (top pages only) ====================
    if (targetBatch === 8) {
      const sources = [
        { name: "Ticketmaster p1", url: "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ", type: "concert" },
        { name: "Ticketmaster p2", url: "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=2", type: "concert" },
        { name: "Live Nation p1", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=1", type: "concert" },
        { name: "Live Nation p2", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=2", type: "concert" },
        { name: "Live Nation p3", url: "https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=3", type: "concert" },
      ];

      const prompt = "Extract ONLY music concerts in Stockholm. Get artist name (clean, no tour name), venue name, date (ISO 8601), ticket URL, and ticket availability. Current year is 2025/2026. EXCLUDE non-Stockholm events.";

      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrape(firecrawlKey, src.url, secondarySourceSchema, prompt, { waitFor: 8000 });
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date)
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type,
              source: src.name.split(" p")[0],
              source_url: src.url,
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

      const prompt = "Extract ONLY stand-up comedy shows. Get performer name, venue name, date (ISO 8601), ticket URL, and ticket availability. Stockholm only. Current year is 2025/2026.";

      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Comedy gap-fill: ${src.name}`);
        const result = await firecrawlScrape(firecrawlKey, src.url, secondarySourceSchema, prompt, { waitFor: 5000 });
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date)
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: "comedy",
              source: src.name,
              source_url: src.url,
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

      const prompt = "Extract music events/concerts in Stockholm. Get artist name, venue name, date (ISO 8601), ticket URL. Current year is 2025/2026. EXCLUDE non-Stockholm events.";

      for (const src of sources) {
        if (!hasTimeBudget()) break;
        console.log(`Gap-fill: ${src.name}`);
        const result = await firecrawlScrape(firecrawlKey, src.url, secondarySourceSchema, prompt, { waitFor: 10000 });
        if (result?.events) {
          const events: ScrapedEvent[] = result.events
            .filter((e: any) => e.artist && e.venue && e.date)
            .map((e: any) => ({
              artist: e.artist.split(/[:\-–—|]/)[0].trim(),
              venue: normalizeVenueName(e.venue),
              date: e.date,
              ticket_url: e.ticket_url || null,
              tickets_available: e.tickets_available ?? false,
              image_url: e.image_url || null,
              event_type: src.type,
              source: src.name,
              source_url: src.url,
            }))
            .filter((e: ScrapedEvent) => isStockholmVenue(e.venue));
          console.log(`${src.name}: ${events.length} events`);
          if (events.length > 0) await upsertEvents(events);
          totalScraped += events.length;
        }
        await delay(2000);
      }
    }

    // Log batch
    await supabase.from("scrape_log").insert({
      batch: targetBatch,
      source: targetBatch === 1 ? "evently" : `secondary-batch-${targetBatch}`,
      events_found: totalScraped,
      events_upserted: totalUpserted,
      duration_ms: Date.now() - START_TIME,
    });

    // Chain
    if (chain) await triggerNextBatch(targetBatch, supabase);

    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    return new Response(
      JSON.stringify({
        success: true,
        message: `Batch ${targetBatch}/${TOTAL_BATCHES}: ${totalScraped} scraped, ${totalUpserted} upserted in ${elapsed}s`,
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
