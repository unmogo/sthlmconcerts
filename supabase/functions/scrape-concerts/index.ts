import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    // Extract image links to pass to AI
    const imageLinks = Array.isArray(links)
      ? links.filter((l: string) => /\.(jpg|jpeg|png|webp|avif)/i.test(l))
      : [];

    if (!markdown) {
      console.log(`No content from ${sourceName}`);
      return [];
    }

    // Check if this is an empty page (Cirkus pagination end)
    if (markdown.includes("Inga evenemang hittades")) {
      console.log(`${sourceName} page is empty (Inga evenemang hittades)`);
      return [];
    }

    console.log(`Got ${markdown.length} chars from ${sourceName}`);

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not set");
      return [];
    }

    const categoryPrompt = eventCategory === "comedy"
      ? `You are a comedy/stand-up event data extractor for Stockholm, Sweden. Extract ONLY stand-up comedy shows, comedy specials, and humorous live performances. EXCLUDE: music concerts, theater plays, musicals, sports.`
      : `You are a concert data extractor for Stockholm, Sweden. Extract ONLY music concerts and live music performances. EXCLUDE: sports events, comedy shows, theater, conferences, exhibitions, family shows, musicals unless they are clearly a music concert. INCLUDE: concerts, live music, DJ sets, music festivals, band performances, solo artist shows, orchestra/symphony concerts.`;

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
              role: "system",
              content: `${categoryPrompt}

IMPORTANT: Clean up artist/performer names. Remove tour names, subtitles, and extra descriptions from the artist field. For example:
- "5 Seconds of Summer: EVERYONE'S A STAR! WORLD TOUR" → "5 Seconds of Summer"
- "Dave – The Boy Who Played the Harp Tour" → "Dave"
- "Bilind Ibrahim - Live in Concert" → "Bilind Ibrahim"

Also normalize venue names to their short form:
- "Avicii Arena, Stockholm" → "Avicii Arena"
- "Södra Teatern – Kägelbanan" → "Södra Teatern"
- "Södra Teatern – Stora Scen" → "Södra Teatern"
- "Hovet, Stockholm" → "Hovet"

Return a JSON array with these fields:
- artist: string (clean performer/band name)
- venue: string (normalized venue name)
- date: string (ISO 8601 datetime. Current year is 2026. If no time given, use 19:00)
- ticket_url: string or null (full URL to buy tickets)
- tickets_available: boolean (true if on sale)
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

    const aiData = await aiResponse.json();
    const content = aiData?.choices?.[0]?.message?.content || "[]";

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

  // Page 1 is the base URL
  const firstPage = await scrapeSource(apiKey, baseUrl, sourceName, eventCategory);
  if (firstPage.length === 0) return all;
  all.push(...firstPage);

  // Pages 2+
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

    // Static concert pages
    const staticConcertUrls = [
      { url: "https://stockholmlive.com/evenemang/", name: "Stockholm Live" },
      { url: "https://stockholmlive.com/evenemang/page/2/", name: "Stockholm Live" },
      { url: "https://stockholmlive.com/evenemang/page/3/", name: "Stockholm Live" },
      // AXS Stockholm
      { url: "https://www.axs.com/se/venues/1702/avicii-arena", name: "AXS" },
      { url: "https://www.axs.com/se/venues/31697/hovet", name: "AXS" },
      { url: "https://www.axs.com/se/venues/141684/strawberry-arena", name: "AXS" },
    ];

    // Konserthuset - month-based calendar, scrape each month through Dec 2026
    const konserthusetMonths = [
      "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ];
    const konserthusetUrls = konserthusetMonths.map((m) => ({
      url: `https://www.konserthuset.se/program-och-biljetter/kalender/?month=${m}`,
      name: "Konserthuset",
    }));

    // Live Nation - paginate through Stockholm events (city 65969, country 212)
    const livenationPages: { url: string; name: string }[] = [];
    for (let p = 1; p <= 50; p++) {
      livenationPages.push({
        url: `https://www.livenation.se/en?CityIds=65969&CountryIds=212&Page=${p}`,
        name: "Live Nation",
      });
    }

    const concertResults = await Promise.allSettled([
      scrapePaginated(firecrawlKey, "https://cirkus.se/sv/evenemang/", "Cirkus", "concert", 10),
      // Gröna Lund - needs longer wait for JS rendering, no onlyMainContent
      scrapeSource(firecrawlKey, "https://www.gronalund.com/en/concerts#filter=Stora%20Scen,Lilla%20Scen", "Gröna Lund", "concert", { waitFor: 10000, onlyMainContent: false }),
      // Kulturhuset Stadsteatern - JS rendered
      scrapeSource(firecrawlKey, "https://kulturhusetstadsteatern.se/konserter", "Kulturhuset", "concert", { waitFor: 8000, onlyMainContent: false }),
      ...staticConcertUrls.map((s) => scrapeSource(firecrawlKey, s.url, s.name, "concert")),
      ...konserthusetUrls.map((s) => scrapeSource(firecrawlKey, s.url, s.name, "concert", { waitFor: 5000 })),
      ...livenationPages.map((s) => scrapeSource(firecrawlKey, s.url, s.name, "concert")),
    ]);

    // Comedy sources
    const comedyResults = await Promise.allSettled([
      scrapeSource(firecrawlKey, "https://www.nojesteatern.se/program/", "Nöjesteatern", "comedy"),
      scrapeSource(firecrawlKey, "https://www.hyvens.se/program/", "Hyvens", "comedy"),
      scrapeSource(firecrawlKey, "https://www.livenation.se/search?query=comedy+stockholm", "Live Nation", "comedy"),
    ]);

    const allConcerts: ScrapedConcert[] = [];
    for (const result of [...concertResults, ...comedyResults]) {
      if (result.status === "fulfilled") {
        allConcerts.push(...result.value);
      }
    }

    console.log(`Total events scraped: ${allConcerts.length}`);

    // Deduplicate by normalized artist+venue+date before upserting
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
    // Strip tour names / subtitles for dedup key (e.g. "Sombr: The Tour" → "sombr")
    const normalizeArtist = (s: string) =>
      normalize(s.split(/[:\-–—|]/)[0].trim());
    const seen = new Map<string, ScrapedConcert>();
    for (const c of allConcerts) {
      const key = `${normalizeArtist(c.artist)}|${normalize(c.venue)}|${c.date}`;
      if (!seen.has(key)) {
        seen.set(key, c);
      } else {
        // Keep the entry with shorter artist name (cleaner)
        const existing = seen.get(key)!;
        if (c.artist.length < existing.artist.length) {
          seen.set(key, c);
        }
      }
    }
    const dedupedConcerts = [...seen.values()];
    console.log(`After dedup: ${dedupedConcerts.length} unique events`);

    // For events without images, try to find artist images
    if (lovableApiKey) {
      const noImageConcerts = dedupedConcerts.filter((c) => !c.image_url);
      const uniqueArtists = [...new Set(noImageConcerts.map((c) => c.artist))];

      const artistsToSearch = uniqueArtists.slice(0, 50);
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

      for (const c of dedupedConcerts) {
        if (!c.image_url && imageMap.has(c.artist)) {
          c.image_url = imageMap.get(c.artist)!;
        }
      }
    }

    // Upsert
    let inserted = 0;
    for (const concert of dedupedConcerts) {
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
        console.error(`Error upserting:`, error.message);
      } else {
        inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scraped ${allConcerts.length} events, deduped to ${dedupedConcerts.length}, upserted ${inserted}`,
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
