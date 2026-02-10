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
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
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

    // Use AI to parse the markdown into structured concert data
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not set, cannot parse concerts");
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
              content: `You are a concert data extractor. Given markdown content from a Swedish concert venue website, extract all upcoming concerts/events. Return a JSON array of objects with these fields:
- artist: string (performer/band name)
- venue: string (venue name, default to "${sourceName}" if not found)  
- date: string (ISO 8601 datetime, best guess if only partial date given. Use 2025/2026 for upcoming dates)
- ticket_url: string or null (link to buy tickets if found)
- tickets_available: boolean (true if tickets seem to be on sale)
- image_url: string or null (artist/event image URL if found)

Only return valid JSON array. No explanation. If no concerts found, return [].
Current year is 2026, month is February.`,
            },
            {
              role: "user",
              content: `Extract concerts from this ${sourceName} page:\n\n${markdown.substring(0, 15000)}`,
            },
          ],
          temperature: 0.1,
        }),
      }
    );

    const aiData = await aiResponse.json();
    const content = aiData?.choices?.[0]?.message?.content || "[]";

    // Parse JSON from AI response (may have markdown code fences)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`No concerts parsed from ${sourceName}`);
      return [];
    }

    const parsed: any[] = JSON.parse(jsonMatch[0]);
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Scrape all sources in parallel
    const sources = [
      { url: "https://stockholmlive.com/evenemang/", name: "Stockholm Live" },
      { url: "https://cirkus.se/sv/evenemang/", name: "Cirkus" },
      { url: "https://www.livenation.se/", name: "Live Nation" },
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

    // Upsert concerts (deduplicate by artist+venue+date)
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
        console.error(`Error upserting concert:`, error.message);
      } else {
        inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scraped ${allConcerts.length} concerts, upserted ${inserted}`,
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
