import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_BATCH_SIZE = 40;
const TIME_BUDGET_MS = 840_000;

const TICKET_SELLER_DOMAINS = [
  "ticketmaster.se", "ticketmaster.com",
  "livenation.se", "livenation.com",
  "axs.com", "tickster.com",
  "billetto.se", "billetto.com",
  "feverup.com", "feverup.se", "fever.com",
  "nortic.se", "bfrk.se",
  "kulturhuset.stockholm.se", "sodrateatern.com",
  "konserthuset.se", "cfrk.se", "trfrk.se",
  "nalen.com", "debaser.se", "fasching.se",
  "gfrk.se", "gronalund.com",
  "allthingslive.se", "ticnet.se",
  "eventim.se", "eventbrite.com",
  "dice.fm", "ra.co",
  "hfrk.se", "strawberryarena.se",
  "tfrk.se", "mfrk.se",
];

const REDIRECT_HOSTS = ["evyy.net", "ffrk.se", "evently.se"];
const URL_REGEX = /https?:\/\/[^\s)\]>"']+/gi;

function isRedirectHostUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return REDIRECT_HOSTS.some((host) => lower.includes(host));
}

function isEventlyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().includes("evently.se");
  } catch {
    return url.toLowerCase().includes("evently.se");
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeMaybe(value: string): string {
  let decoded = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function isSellerHost(hostname: string): boolean {
  return TICKET_SELLER_DOMAINS.some((domain) => hostname.includes(domain));
}

function extractTicketUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;

  const decodedInput = decodeMaybe(rawUrl.trim());

  try {
    const parsed = new URL(decodedInput);
    const hostname = parsed.hostname.toLowerCase();

    if (isSellerHost(hostname)) {
      return decodedInput;
    }

    if (REDIRECT_HOSTS.some((host) => hostname.includes(host))) {
      const redirectParams = ["u", "url", "redirect", "target", "dest", "destination"];
      for (const param of redirectParams) {
        const target = parsed.searchParams.get(param);
        if (!target) continue;

        const extracted = extractTicketUrl(target);
        if (extracted) return extracted;
      }
    }

    const encodedMatch = decodedInput.match(/https?%3A%2F%2F[^\s"'&]+/i);
    if (encodedMatch?.[0]) {
      return extractTicketUrl(encodedMatch[0]);
    }

    return null;
  } catch {
    const direct = decodedInput.match(URL_REGEX)?.[0];
    if (!direct) return null;
    return extractTicketUrl(direct);
  }
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const directUrls = text.match(URL_REGEX) ?? [];
  const encodedUrls = text.match(/https?%3A%2F%2F[^\s"'&)<>]+/gi) ?? [];
  return [...directUrls, ...encodedUrls].map((u) => decodeMaybe(u));
}

function pickEventlyUrl(ticketUrl: string | null, sourceUrl: string | null): string | null {
  if (ticketUrl && (isEventlyUrl(ticketUrl) || isRedirectHostUrl(ticketUrl))) return ticketUrl;
  if (!ticketUrl && sourceUrl && sourceUrl.includes("evently.se")) return sourceUrl;
  return null;
}

async function lookupTicketUrlFromPage(url: string, firecrawlKey: string): Promise<string | null> {
  try {
    const rawRes = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; STHLMConcertsBot/1.0)",
      },
    }, 12_000);

    if (rawRes.ok) {
      const rawHtml = await rawRes.text();
      const rawCandidates = [
        ...Array.from(rawHtml.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]),
        ...extractUrlsFromText(rawHtml),
      ];

      for (const candidate of rawCandidates) {
        const extracted = extractTicketUrl(candidate);
        if (extracted) return extracted;
      }
    }

    const scrapeRes = await fetchWithTimeout("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["links", "markdown", "html"],
        onlyMainContent: false,
      }),
    }, 18_000);

    if (!scrapeRes.ok) return null;

    const scrapeData = await scrapeRes.json();
    const links: string[] = scrapeData?.data?.links || scrapeData?.links || [];
    const markdown: string = scrapeData?.data?.markdown || scrapeData?.markdown || "";
    const html: string = scrapeData?.data?.html || scrapeData?.html || "";

    const hrefMatches = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]);
    const htmlUrls = extractUrlsFromText(html);
    const markdownUrls = extractUrlsFromText(markdown);

    const candidates = [...new Set([...links, ...hrefMatches, ...markdownUrls, ...htmlUrls])];

    for (const candidate of candidates) {
      const extracted = extractTicketUrl(candidate);
      if (extracted) return extracted;
    }

    return null;
  } catch {
    return null;
  }
}

async function searchTicketUrlFallback(
  artist: string,
  venue: string,
  eventDate: string,
  firecrawlKey: string,
): Promise<string | null> {
  const year = new Date(eventDate).getUTCFullYear();
  const queries = [
    `${artist} ${venue} stockholm tickets`,
    `${artist} ${year} stockholm tickets`,
  ];

  for (const query of queries) {
    try {
      const searchRes = await fetchWithTimeout("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit: 5 }),
      }, 15_000);

      if (!searchRes.ok) continue;

      const searchData = await searchRes.json();
      const results: Array<{ url?: string; link?: string }> =
        (Array.isArray(searchData?.data) ? searchData.data : []) ||
        (Array.isArray(searchData?.results) ? searchData.results : []);

      for (const result of results.slice(0, 3)) {
        const resultUrl = result?.url || result?.link;
        if (!resultUrl) continue;

        const direct = extractTicketUrl(resultUrl);
        if (direct) return direct;

        const scraped = await lookupTicketUrlFromPage(resultUrl, firecrawlKey);
        if (scraped) return scraped;
      }
    } catch {
      // continue to next query
    }
  }

  return null;
}

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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const cursorId = typeof body.cursorId === "string" && body.cursorId.length > 0 ? body.cursorId : null;
    const chain = body.chain !== false;
    const batchSizeRaw = Number(body.batchSize ?? DEFAULT_BATCH_SIZE);
    const batchSize = Number.isFinite(batchSizeRaw)
      ? Math.max(1, Math.min(100, Math.trunc(batchSizeRaw)))
      : DEFAULT_BATCH_SIZE;

    let query = supabase
      .from("concerts")
      .select("id, artist, venue, date, ticket_url, source_url")
      .gte("date", new Date().toISOString())
      .or("ticket_url.ilike.%evently.se%,ticket_url.ilike.%evyy.net%,ticket_url.ilike.%ffrk.se%,and(ticket_url.is.null,source_url.ilike.%evently.se%)")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (cursorId) query = query.gt("id", cursorId);

    const { data: concerts, error } = await query;

    if (error) throw error;
    if (!concerts || concerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Done. No more evently ticket links to resolve.", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Batch cursor=${cursorId ?? "start"}: processing ${concerts.length} evently ticket links`);

    const startTime = Date.now();
    let lastCursorId: string | null = cursorId;
    let processed = 0;
    let updated = 0;
    let pageHits = 0;
    let searchHits = 0;
    let unresolved = 0;
    let timedOut = false;

    for (const concert of concerts) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true;
        console.log("Time budget exceeded, chaining from last processed cursor");
        break;
      }

      processed++;
      lastCursorId = concert.id;

      const eventlyUrl = pickEventlyUrl(concert.ticket_url, concert.source_url);
      if (!eventlyUrl) {
        unresolved++;
        continue;
      }

      let resolvedUrl = await lookupTicketUrlFromPage(eventlyUrl, firecrawlKey);
      if (resolvedUrl) {
        pageHits++;
      } else {
        resolvedUrl = await searchTicketUrlFallback(concert.artist, concert.venue, concert.date, firecrawlKey);
        if (resolvedUrl) searchHits++;
      }

      if (resolvedUrl) {
        const { error: updateError } = await supabase
          .from("concerts")
          .update({ ticket_url: resolvedUrl })
          .eq("id", concert.id);

        if (updateError) {
          console.error(`Failed to update ${concert.artist}:`, updateError.message);
          unresolved++;
        } else {
          updated++;
          console.log(`✓ ${concert.artist}: ${resolvedUrl}`);
        }
      } else {
        unresolved++;
        console.log(`✗ ${concert.artist}: no direct seller found for ${eventlyUrl}`);
      }

      await delay(250);
    }

    const message = `Batch cursor=${cursorId ?? "start"}: processed ${processed}/${concerts.length}, updated ${updated} (page: ${pageHits}, search: ${searchHits}), ${unresolved} unresolved`;
    console.log(message);

    const hasMore = !!lastCursorId && processed > 0 && (timedOut || concerts.length === batchSize);
    const shouldChain = chain && hasMore;

    if (shouldChain) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
      fetchWithTimeout(`${supabaseUrl}/functions/v1/resolve-tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ cursorId: lastCursorId, chain: true, batchSize }),
      }, 4_000).catch((err) => console.error("Chain call failed:", err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message,
        processed,
        updated,
        unresolved,
        pageHits,
        searchHits,
        nextCursorId: hasMore ? lastCursorId : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("resolve-tickets error:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
