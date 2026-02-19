import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Global time budget: stop processing before edge function timeout
const START_TIME = Date.now();
const TIME_BUDGET_MS = 120_000; // 120 seconds, well under 150s timeout
let aiCreditsExhausted = false;

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

async function scrapeSource(
  apiKey: string,
  url: string,
  sourceName: string,
  eventCategory: string,
  options?: { waitFor?: number; onlyMainContent?: boolean }
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
        formats: ["markdown", "links"],
        onlyMainContent: options?.onlyMainContent ?? true,
        waitFor: options?.waitFor ?? 5000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Firecrawl error for ${sourceName}:`, data);
      return [];
    }

    const markdown = data?.data?.markdown || data?.markdown || "";
    const links = data?.data?.links || data?.links || [];
    const imageLinks = Array.isArray(links)
      ? links.filter((l: string) => /\.(jpg|jpeg|png|webp|avif)/i.test(l))
      : [];

    if (!markdown) {
      console.log(`No content from ${sourceName}`);
      return [];
    }

    if (markdown.includes("Inga evenemang hittades")) {
      console.log(`${sourceName} page is empty (Inga evenemang hittades)`);
      return [];
    }

    console.log(`Got ${markdown.length} chars from ${sourceName}`);

    if (aiCreditsExhausted) {
      console.log(`Skipping AI for ${sourceName} - credits exhausted`);
      return [];
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not set");
      return [];
    }

    const categoryPrompt = eventCategory === "comedy"
      ? `You are a comedy/stand-up event data extractor for Stockholm, Sweden. Extract ONLY stand-up comedy shows, comedy specials, and humorous live performances. EXCLUDE: music concerts, theater plays, musicals, sports.`
      : `You are a concert data extractor for Stockholm, Sweden. Extract ONLY music concerts and live music performances. EXCLUDE: sports events, comedy shows, theater, conferences, exhibitions, family shows, musicals unless they are clearly a music concert. INCLUDE: concerts, live music, DJ sets, music festivals, band performances, solo artist shows, orchestra/symphony concerts.`;

    // AI call with retry for rate limits
    let aiData: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const backoff = attempt * 10000; // 10s, 20s
        console.log(`Rate limited, waiting ${backoff / 1000}s before retry ${attempt + 1}...`);
        await delay(backoff);
      }

      const aiResponse = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content: `${categoryPrompt}

IMPORTANT: Clean up artist/performer names. Remove tour names, subtitles, and extra descriptions from the artist field. For example:
- "5 Seconds of Summer: EVERYONE'S A STAR! WORLD TOUR" → "5 Seconds of Summer"
- "Dave – The Boy Who Played the Harp Tour" → "Dave"
- "Bilind Ibrahim - Live in Concert" → "Bilind Ibrahim"

Also normalize venue names to their short form. Remove city names and sub-venue details:
- "Avicii Arena, Stockholm" → "Avicii Arena"
- "Södra Teatern – Kägelbanan" → "Södra Teatern"
- "Södra Teatern – Stora Scen" → "Södra Teatern"
- "Hovet, Stockholm" → "Hovet"
- "Ulriksdals Slott - Solna" → "Ulriksdals Slott"
- "Cirkus, Stockholm" → "Cirkus"
- "Gröna Lund" (always use this exact name for Gröna Lund events)
- "Kulturhuset Stadsteatern" or "Studion" → "Kulturhuset Stadsteatern"

IMPORTANT: When a venue name includes a city suffix (e.g. ", Stockholm", " - Solna"), remove it. When it includes a sub-venue (e.g. "– Stora Scen"), remove it. Use the shortest recognizable venue name.

IMPORTANT: Extract ALL events on the page, including those where tickets are not yet on sale. We want to capture future events even if ticket sales haven't started.

Return a JSON array with these fields:
- artist: string (clean performer/band name)
- venue: string (normalized venue name)
- date: string (ISO 8601 datetime. Current year is 2026. If no time given, use 19:00)
- ticket_url: string or null (full URL to buy tickets)
- tickets_available: boolean (true if on sale, false if not yet on sale or sold out)
- image_url: string or null (full URL to artist/event image if found in the content or image links below)

IMPORTANT: Match artist images from the image links provided below. Look for image filenames that contain or relate to artist names.

Return ONLY valid JSON array. No explanation. If no events found, return [].`,
              },
              {
                role: "user",
                content: `Extract events from this ${sourceName} page. Source URL: ${url}\n\n${markdown.substring(0, 18000)}${imageLinks.length > 0 ? `\n\n--- IMAGE LINKS FOUND ON PAGE ---\n${imageLinks.slice(0, 100).join("\n")}` : ""}`,
              },
            ],
            temperature: 0.1,
          }),
        }
      );

      aiData = await aiResponse.json();
      if (aiResponse.ok) break;
      if (aiResponse.status === 429) {
        console.log(`Rate limited on attempt ${attempt + 1} for ${sourceName}`);
        continue;
      }
      if (aiResponse.status === 402) {
        console.log(`AI credits exhausted, skipping remaining AI calls`);
        aiCreditsExhausted = true;
        return [];
      }
      console.error(`AI gateway error for ${sourceName}:`, JSON.stringify(aiData).substring(0, 500));
      return [];
    }

    if (!aiData?.choices?.[0]?.message?.content) {
      console.log(`No AI response after retries for ${sourceName}`);
      return [];
    }
    const content = aiData?.choices?.[0]?.message?.content || "[]";
    console.log(`AI response preview for ${sourceName}: ${content.substring(0, 200)}`);

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`No events parsed from ${sourceName}`);
      return [];
    }

    const parsed: any[] = JSON.parse(jsonMatch[0]);
    console.log(`Parsed ${parsed.length} events from ${sourceName}`);

    return parsed.map((c: any) => ({
      artist: c.artist || "Unknown",
      venue: c.venue || sourceName,
      date: c.date || new Date().toISOString(),
      ticket_url: c.ticket_url || null,
      ticket_sale_date: c.ticket_sale_date || null,
      tickets_available: c.tickets_available || false,
      image_url: c.image_url || null,
      event_type: eventCategory,
      source: sourceName,
      source_url: url,
    }));
  } catch (err) {
    console.error(`Error scraping ${sourceName}:`, err);
    return [];
  }
}

// Paginate a source until empty page
async function scrapePaginated(
  apiKey: string,
  baseUrl: string,
  sourceName: string,
  eventCategory: string,
  maxPages: number = 10
): Promise<ScrapedConcert[]> {
  const all: ScrapedConcert[] = [];

  const firstPage = await scrapeSource(apiKey, baseUrl, sourceName, eventCategory);
  if (firstPage.length === 0) return all;
  all.push(...firstPage);

  for (let page = 2; page <= maxPages; page++) {
    const url = `${baseUrl}page/${page}/`;
    const results = await scrapeSource(apiKey, url, sourceName, eventCategory);
    if (results.length === 0) {
      console.log(`${sourceName} pagination ended at page ${page}`);
      break;
    }
    all.push(...results);
  }

  return all;
}

// Process tasks sequentially to avoid AI rate limits
async function scrapeBatch(
  tasks: Array<{ fn: () => Promise<ScrapedConcert[]>; name: string }>
): Promise<ScrapedConcert[]> {
  const all: ScrapedConcert[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (!hasTimeBudget()) {
      console.log(`Time budget exceeded, stopping batch at task ${i}/${tasks.length}`);
      break;
    }
    if (aiCreditsExhausted) {
      console.log(`AI credits exhausted, skipping remaining tasks`);
      break;
    }
    if (i > 0) await delay(5000);
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

// Normalize helpers for deduplication
const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
const normalizeArtist = (s: string) => normalize(s.split(/[:\-–—|]/)[0].trim());
const normalizeVenue = (s: string) => normalize(s.split(/[,\-–—]/)[0].trim());
const dateOnly = (d: string) => {
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return d;
  }
};

function deduplicateConcerts(concerts: ScrapedConcert[]): ScrapedConcert[] {
  const seen = new Map<string, ScrapedConcert>();
  for (const c of concerts) {
    const key = `${normalizeArtist(c.artist)}|${normalizeVenue(c.venue)}|${dateOnly(c.date)}`;
    if (!seen.has(key)) {
      seen.set(key, c);
    } else {
      const existing = seen.get(key)!;
      // Keep entry with more info (image, ticket_url) or shorter artist name
      if (
        (!existing.image_url && c.image_url) ||
        (!existing.ticket_url && c.ticket_url) ||
        (c.artist.length < existing.artist.length)
      ) {
        seen.set(key, { ...existing, ...c, image_url: c.image_url || existing.image_url, ticket_url: c.ticket_url || existing.ticket_url });
      }
    }
  }
  return [...seen.values()];
}

async function searchArtistImage(
  artistName: string,
  lovableApiKey: string
): Promise<string | null> {
  try {
    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: `What is a commonly used press photo or Wikipedia image URL for the music artist "${artistName}"? If you know a real URL to their image (from Wikipedia, their official site, or a major music platform), return ONLY the URL. If you don't know a real URL, respond with "none".`,
            },
          ],
          temperature: 0,
        }),
      }
    );
    const data = await aiResponse.json();
    const url = data?.choices?.[0]?.message?.content?.trim();
    if (url && url.startsWith("http") && !url.includes(" ")) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Support batch filtering: POST { batch: 7, page: 1 } to run specific batch/page
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

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const allConcerts: ScrapedConcert[] = [];
    let totalUpserted = 0;

    // Helper: deduplicate + upsert a batch incrementally
    async function upsertBatch(concerts: ScrapedConcert[]) {
      const deduped = deduplicateConcerts(concerts);
      let count = 0;
      for (const concert of deduped) {
        const { error } = await supabase.from("concerts").upsert(
          {
            artist: concert.artist,
            venue: concert.venue,
            date: concert.date,
            ticket_url: concert.ticket_url,
            ticket_sale_date: concert.ticket_sale_date,
            tickets_available: concert.tickets_available,
            image_url: concert.image_url,
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

    // ==================== BATCH 1: Main Stockholm venues ====================
    if (shouldRun(1) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 1: Main Stockholm venues ===");
    const batch1 = await scrapeBatch([
      {
        name: "Cirkus",
        fn: () => scrapePaginated(firecrawlKey, "https://cirkus.se/sv/evenemang/", "Cirkus", "concert", 10),
      },
      {
        name: "Gröna Lund",
        fn: () => scrapeSource(firecrawlKey, "https://www.gronalund.com/en/concerts", "Gröna Lund", "concert", { waitFor: 10000, onlyMainContent: false }),
      },
      {
        name: "Södra Teatern",
        fn: () => scrapeSource(firecrawlKey, "https://sodrateatern.com/", "Södra Teatern", "concert", { waitFor: 8000, onlyMainContent: false }),
      },
    ]);
    allConcerts.push(...batch1);
    await upsertBatch(batch1);
    }

    // ==================== BATCH 2: Stockholm Live + AXS ====================
    if (shouldRun(2) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 2: Stockholm Live + AXS ===");
    const batch2 = await scrapeBatch([
      { name: "Stockholm Live p1", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/", "Stockholm Live", "concert") },
      { name: "Stockholm Live p2", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/2/", "Stockholm Live", "concert") },
      { name: "Stockholm Live p3", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/3/", "Stockholm Live", "concert") },
      { name: "Stockholm Live p4", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/4/", "Stockholm Live", "concert") },
      { name: "Stockholm Live p5", fn: () => scrapeSource(firecrawlKey, "https://stockholmlive.com/evenemang/page/5/", "Stockholm Live", "concert") },
      { name: "AXS Avicii Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/1702/avicii-arena", "AXS", "concert") },
      { name: "AXS Hovet", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/31697/hovet", "AXS", "concert") },
      { name: "AXS Strawberry Arena", fn: () => scrapeSource(firecrawlKey, "https://www.axs.com/se/venues/141684/strawberry-arena", "AXS", "concert") },
    ]);
    allConcerts.push(...batch2);
    await upsertBatch(batch2);
    }

    // ==================== BATCH 3: Konserthuset (month-based) ====================
    if (shouldRun(3) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 3: Konserthuset ===");
    const konserthusetMonths = [
      "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ];
    const batch3 = await scrapeBatch(
      konserthusetMonths.map((m) => ({
        name: `Konserthuset ${m}`,
        fn: () => scrapeSource(
          firecrawlKey,
          `https://www.konserthuset.se/program-och-biljetter/kalender/?month=${m}`,
          "Konserthuset",
          "concert",
          { waitFor: 5000 }
        ),
      }))
    );
    allConcerts.push(...batch3);
    await upsertBatch(batch3);
    }

    // ==================== BATCH 4: Ticketmaster Stockholm Music ====================
    if (shouldRun(4) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 4: Ticketmaster ===");
    const batch4 = await scrapeBatch([
      {
        name: "Ticketmaster Stockholm Music",
        fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }),
      },
      {
        name: "Ticketmaster Stockholm Music p2",
        fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=2", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }),
      },
      {
        name: "Ticketmaster Stockholm Music p3",
        fn: () => scrapeSource(firecrawlKey, "https://www.ticketmaster.se/discover/stockholm?categoryId=KZFzniwnSyZfZ7v7nJ&page=3", "Ticketmaster", "concert", { waitFor: 8000, onlyMainContent: false }),
      },
    ]);
    allConcerts.push(...batch4);
    await upsertBatch(batch4);
    }

    // ==================== BATCH 5: Live Nation (full 50 pages) ====================
    if (shouldRun(5) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 5: Live Nation ===");
    // Run in sub-batches of 10 pages to avoid memory pressure, upsert after each sub-batch
    const totalLNPages = 50;
    const lnSubBatchSize = 10;
    for (let start = 1; start <= totalLNPages && hasTimeBudget() && !aiCreditsExhausted; start += lnSubBatchSize) {
      const end = Math.min(start + lnSubBatchSize - 1, totalLNPages);
      const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      console.log(`Live Nation sub-batch pages ${start}-${end}`);
      const subBatch = await scrapeBatch(
        pages.map((p) => ({
          name: `Live Nation p${p}`,
          fn: () => scrapeSource(firecrawlKey, `https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=${p}`, "Live Nation", "concert"),
        }))
      );
      allConcerts.push(...subBatch);
      await upsertBatch(subBatch);
    }
    }

    // ==================== BATCH 6: Comedy ====================
    if (shouldRun(6) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 6: Comedy ===");
    const batch6 = await scrapeBatch([
      { name: "Nöjesteatern", fn: () => scrapeSource(firecrawlKey, "https://www.nojesteatern.se/program/", "Nöjesteatern", "comedy") },
      { name: "Hyvens", fn: () => scrapeSource(firecrawlKey, "https://www.hyvens.se/program/", "Hyvens", "comedy") },
      { name: "Live Nation Comedy", fn: () => scrapeSource(firecrawlKey, "https://www.livenation.se/search?query=comedy+stockholm", "Live Nation", "comedy") },
    ]);
    allConcerts.push(...batch6);
    await upsertBatch(batch6);
    }

    // ==================== BATCH 7: Kulturhuset – auto-discover all concert pages ====================
    if (shouldRun(7) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 7: Kulturhuset (auto-discover) ===");

    // Step 1: scrape listing page to get all concert URLs
    let kulturhusetUrls: string[] = [];
    try {
      const listingRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://kulturhusetstadsteatern.se/konserter/",
          formats: ["links"],
          onlyMainContent: false,
          waitFor: 6000,
        }),
      });
      const listingData = await listingRes.json();
      const allLinks: string[] = listingData?.data?.links || listingData?.links || [];
      kulturhusetUrls = allLinks.filter((l: string) =>
        l.startsWith("https://kulturhusetstadsteatern.se/konserter/") &&
        l !== "https://kulturhusetstadsteatern.se/konserter/"
      );
      console.log(`Kulturhuset: discovered ${kulturhusetUrls.length} concert URLs`);
    } catch (err) {
      console.error("Failed to discover Kulturhuset URLs:", err);
    }

    // Step 2: skip artists already in DB
    const { data: existingKulturhuset } = await supabase
      .from("concerts")
      .select("artist")
      .or("source.eq.Kulturhuset Stadsteatern,venue.ilike.%kulturhuset%");
    const existingArtists = new Set(
      (existingKulturhuset || []).map((c: any) => c.artist.toLowerCase())
    );

    const missingUrls = kulturhusetUrls.filter((url) => {
      const slug = url.split("/").pop() || "";
      const artistGuess = slug.replace(/-/g, " ").toLowerCase();
      return ![...existingArtists].some(
        (a) => a.includes(artistGuess) || artistGuess.includes(a)
      );
    });

    console.log(`Kulturhuset: ${kulturhusetUrls.length} total, ${missingUrls.length} to scrape`);

    // Process 4 URLs per page to avoid timeout
    const pageSize = 4;
    const startIdx = (targetPage - 1) * pageSize;
    const pageUrls = missingUrls.slice(startIdx, startIdx + pageSize);
    console.log(`Kulturhuset page ${targetPage}: processing ${pageUrls.length} URLs (${startIdx}-${startIdx + pageUrls.length} of ${missingUrls.length})`);

    const batch7 = await scrapeBatch(
      pageUrls.map((url) => ({
        name: `Kulturhuset: ${url.split("/").pop()}`,
        fn: () => scrapeSource(firecrawlKey, url, "Kulturhuset Stadsteatern", "concert", { waitFor: 5000 }),
      }))
    );
    allConcerts.push(...batch7);
    await upsertBatch(batch7);
    }

    // ==================== BATCH 8: Resident Advisor Stockholm ====================
    if (shouldRun(8) && hasTimeBudget() && !aiCreditsExhausted) {
    console.log("=== BATCH 8: Resident Advisor Stockholm ===");
    // RA paginates via ?page=N
    const raPages = Array.from({ length: 5 }, (_, i) => i + 1);
    const batch8 = await scrapeBatch(
      raPages.map((p) => ({
        name: `RA Stockholm p${p}`,
        fn: () => scrapeSource(
          firecrawlKey,
          p === 1
            ? "https://ra.co/events/se/stockholm"
            : `https://ra.co/events/se/stockholm?page=${p}`,
          "Resident Advisor",
          "concert",
          { waitFor: 8000, onlyMainContent: false }
        ),
      }))
    );
    allConcerts.push(...batch8);
    await upsertBatch(batch8);
    }

    // ==================== Image backfill ====================
    if (shouldRun(9) || targetBatch === null) {
    console.log("=== Image backfill ===");
    const dedupedAll = deduplicateConcerts(allConcerts);
    if (lovableApiKey) {
      const noImageConcerts = dedupedAll.filter((c) => !c.image_url);
      const uniqueArtists = [...new Set(noImageConcerts.map((c) => c.artist))];
      const artistsToSearch = uniqueArtists.slice(0, 30);

      const imageResults = await Promise.allSettled(
        artistsToSearch.map(async (artist) => {
          const url = await searchArtistImage(artist, lovableApiKey);
          return { artist, url };
        })
      );

      const imageMap = new Map<string, string>();
      for (const r of imageResults) {
        if (r.status === "fulfilled" && r.value.url) {
          imageMap.set(r.value.artist, r.value.url);
        }
      }

      for (const [artist, imageUrl] of imageMap) {
        await supabase
          .from("concerts")
          .update({ image_url: imageUrl })
          .eq("artist", artist)
          .is("image_url", null);
      }
      console.log(`Backfilled images for ${imageMap.size} artists`);
    }
    }

    console.log(`Total scraped: ${allConcerts.length}, Total upserted: ${totalUpserted}`);

    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    const statusNote = aiCreditsExhausted ? " (stopped: AI credits exhausted)" : !hasTimeBudget() ? " (stopped: time limit reached)" : "";
    return new Response(
      JSON.stringify({
        success: true,
        message: `Scraped ${allConcerts.length} events, upserted ${totalUpserted} in ${elapsed}s${statusNote}`,
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
