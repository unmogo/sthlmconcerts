import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TICKET_SELLER_DOMAINS = [
  "ticketmaster.se",
  "ticketmaster.com",
  "livenation.se",
  "livenation.com",
  "axs.com",
  "tickster.com",
  "billetto.se",
  "billetto.com",
  "nortic.se",
  "bfrk.se",
  "kulturhuset.stockholm.se",
  "sodrateatern.com",
  "konserthuset.se",
  "cfrk.se",
  "bfrk.se",
  "trfrk.se",
  "nalen.com",
  "debaser.se",
  "fasching.se",
  "gfrk.se",
  "gronalund.com",
  "allthingslive.se",
  "ticnet.se",
  "eventim.se",
  "eventbrite.com",
  "dice.fm",
  "ra.co",
  "hfrk.se",
  "strawberryarena.se",
  "tfrk.se",
  "mfrk.se",
];

function isTicketSellerUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return TICKET_SELLER_DOMAINS.some((d) => hostname.includes(d));
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, message: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find concerts with evently ticket URLs
    const { data: concerts, error } = await supabase
      .from("concerts")
      .select("id, artist, venue, date, ticket_url, source_url")
      .gte("date", new Date().toISOString())
      .ilike("ticket_url", "%evently.se%")
      .order("date", { ascending: true });

    if (error) throw error;
    if (!concerts || concerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No concerts with evently ticket URLs", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${concerts.length} concerts with evently.se ticket URLs`);

    // Cache: evently URL → resolved ticket URL
    const cache = new Map<string, string | null>();
    let updated = 0;
    let failed = 0;

    for (const concert of concerts) {
      const eventlyUrl = concert.ticket_url || concert.source_url;
      if (!eventlyUrl || !eventlyUrl.includes("evently.se")) {
        failed++;
        continue;
      }

      // Check cache
      if (cache.has(eventlyUrl)) {
        const cached = cache.get(eventlyUrl);
        if (cached) {
          await supabase.from("concerts").update({ ticket_url: cached }).eq("id", concert.id);
          updated++;
        } else {
          failed++;
        }
        continue;
      }

      try {
        // Scrape the evently detail page for links
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: eventlyUrl,
            formats: ["links", "markdown"],
            onlyMainContent: false,
          }),
        });

        if (!scrapeRes.ok) {
          console.error(`Firecrawl error for ${concert.artist}: ${scrapeRes.status}`);
          cache.set(eventlyUrl, null);
          failed++;
          continue;
        }

        const scrapeData = await scrapeRes.json();
        const links: string[] = scrapeData?.data?.links || scrapeData?.links || [];
        const markdown: string = scrapeData?.data?.markdown || scrapeData?.markdown || "";

        // Strategy 1: Find a direct ticket seller link in the page links
        let ticketUrl: string | null = null;
        for (const link of links) {
          if (isTicketSellerUrl(link)) {
            ticketUrl = link;
            break;
          }
        }

        // Strategy 2: Extract from markdown (sometimes ticket links are in button text)
        if (!ticketUrl) {
          const urlRegex = /https?:\/\/[^\s)\]>"]+/g;
          const mdUrls = markdown.match(urlRegex) || [];
          for (const u of mdUrls) {
            if (isTicketSellerUrl(u)) {
              ticketUrl = u;
              break;
            }
          }
        }

        cache.set(eventlyUrl, ticketUrl);

        if (ticketUrl) {
          const { error: updateError } = await supabase
            .from("concerts")
            .update({ ticket_url: ticketUrl })
            .eq("id", concert.id);

          if (updateError) {
            console.error(`Failed to update ${concert.artist}:`, updateError.message);
            failed++;
          } else {
            console.log(`✓ ${concert.artist}: ${ticketUrl}`);
            updated++;
          }
        } else {
          console.log(`✗ ${concert.artist}: no ticket seller found on ${eventlyUrl}`);
          failed++;
        }

        // Rate limit
        await delay(800);
      } catch (err) {
        console.error(`Error resolving ${concert.artist}:`, err);
        cache.set(eventlyUrl, null);
        failed++;
      }
    }

    const message = `Resolved ${updated} ticket URLs, ${failed} unresolved, out of ${concerts.length} total`;
    console.log(message);

    return new Response(
      JSON.stringify({ success: true, message, updated, failed, total: concerts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("resolve-tickets error:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
