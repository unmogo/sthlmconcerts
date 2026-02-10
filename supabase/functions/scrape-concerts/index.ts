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
  source: string;
  source_url: string;
}

async function scrapeSource(
  apiKey: string,
  url: string,
  sourceName: string
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
        onlyMainContent: true,
        waitFor: 5000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Firecrawl error for ${sourceName}:`, data);
      return [];
    }

    const markdown = data?.data?.markdown || data?.markdown || "";
    if (!markdown) {
      console.log(`No content from ${sourceName}`);
      return [];
    }

    console.log(`Got ${markdown.length} chars from ${sourceName}`);

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not set");
      return [];
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
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a concert data extractor for Stockholm, Sweden. Given markdown from a venue/ticketing website, extract ONLY music concerts and live music performances. 

EXCLUDE: sports events (football, hockey, etc.), comedy shows, theater, conferences, exhibitions, family shows, musicals unless they are clearly a music concert.

INCLUDE: concerts, live music, DJ sets, music festivals, band performances, solo artist shows, orchestra/symphony concerts.

Return a JSON array with these fields:
- artist: string (performer/band name — clean it up, no extra text)
- venue: string (venue name in Stockholm)  
- date: string (ISO 8601 datetime. Current year is 2026. If no time given, use 19:00)
- ticket_url: string or null (full URL to buy tickets)
- tickets_available: boolean (true if on sale)
- image_url: string or null (full URL to artist/event image if found in the markdown)

Return ONLY valid JSON array. No explanation. If no concerts found, return [].`,
            },
            {
              role: "user",
              content: `Extract ONLY music concerts from this ${sourceName} page. Source URL: ${url}\n\n${markdown.substring(0, 20000)}`,
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
      console.log(`No concerts parsed from ${sourceName}`);
      return [];
    }

    const parsed: any[] = JSON.parse(jsonMatch[0]);
    console.log(`Parsed ${parsed.length} concerts from ${sourceName}`);
    
    return parsed.map((c: any) => ({
      artist: c.artist || "Unknown",
      venue: c.venue || sourceName,
      date: c.date || new Date().toISOString(),
      ticket_url: c.ticket_url || null,
      ticket_sale_date: c.ticket_sale_date || null,
      tickets_available: c.tickets_available || false,
      image_url: c.image_url || null,
      source: sourceName,
      source_url: url,
    }));
  } catch (err) {
    console.error(`Error scraping ${sourceName}:`, err);
    return [];
  }
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

    // Scrape multiple pages from each source for better coverage
    const sources = [
      { url: "https://stockholmlive.com/evenemang/", name: "Stockholm Live" },
      { url: "https://stockholmlive.com/evenemang/page/2/", name: "Stockholm Live" },
      { url: "https://stockholmlive.com/evenemang/page/3/", name: "Stockholm Live" },
      { url: "https://cirkus.se/sv/evenemang/", name: "Cirkus" },
      { url: "https://cirkus.se/sv/evenemang/page/2/", name: "Cirkus" },
      { url: "https://cirkus.se/sv/evenemang/page/3/", name: "Cirkus" },
      { url: "https://cirkus.se/sv/evenemang/page/4/", name: "Cirkus" },
      { url: "https://www.livenation.se/", name: "Live Nation" },
      { url: "https://www.livenation.se/venue/2702/friends-arena-evenemang", name: "Live Nation" },
      { url: "https://www.livenation.se/venue/59539/avicii-arena-evenemang", name: "Live Nation" },
    ];

    const results = await Promise.allSettled(
      sources.map((s) => scrapeSource(firecrawlKey, s.url, s.name))
    );

    const allConcerts: ScrapedConcert[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        allConcerts.push(...result.value);
      }
    }

    console.log(`Total concerts scraped: ${allConcerts.length}`);

    // For concerts without images, try to find artist images
    if (lovableApiKey) {
      const noImageConcerts = allConcerts.filter((c) => !c.image_url);
      const uniqueArtists = [...new Set(noImageConcerts.map((c) => c.artist))];
      
      // Limit to avoid timeout
      const artistsToSearch = uniqueArtists.slice(0, 15);
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

      for (const c of allConcerts) {
        if (!c.image_url && imageMap.has(c.artist)) {
          c.image_url = imageMap.get(c.artist)!;
        }
      }
    }

    // Upsert
    let inserted = 0;
    for (const concert of allConcerts) {
      const { error } = await supabase.from("concerts").upsert(
        {
          artist: concert.artist,
          venue: concert.venue,
          date: concert.date,
          ticket_url: concert.ticket_url,
          ticket_sale_date: concert.ticket_sale_date,
          tickets_available: concert.tickets_available,
          image_url: concert.image_url,
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
        message: `Scraped ${allConcerts.length} concerts from ${sources.length} pages, upserted ${inserted}`,
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
