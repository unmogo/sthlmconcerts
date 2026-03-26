import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_BATCH_SIZE = 30;
const TIME_BUDGET_MS = 840_000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isEventlyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().includes("evently.se");
  } catch {
    return url.toLowerCase().includes("evently.se");
  }
}

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(feat|featuring|ft)\b.*$/i, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function needsImageRefresh(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.startsWith("data:image") ||
    lower.includes("example.com") ||
    lower.includes("widget-launcher.imbox.io") ||
    lower.includes("konserthuset.se/globalassets") ||
    lower.includes("evently.se/api/file") ||
    lower.includes("evently.se/img/") ||
    lower.includes("i.scdn.co") ||
    lower.includes("localhost") ||
    lower.includes("lovable.app") ||
    lower.includes("id-preview--") ||
    lower.includes("placeholder") ||
    lower.includes("blank")
  );
}

function isBlockedImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.startsWith("data:image") ||
    lower.includes("example.com") ||
    lower.includes("widget-launcher.imbox.io") ||
    lower.includes("konserthuset.se/globalassets") ||
    lower.includes("evently.se/api/file") ||
    lower.includes("evently.se/img/") ||
    lower.includes("localhost") ||
    lower.includes("lovable.app") ||
    lower.includes("id-preview--")
  );
}

function isLikelyLogoOrPlaceholder(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("logo") ||
    lower.includes("icon") ||
    lower.includes("avatar") ||
    lower.includes("sprite") ||
    lower.includes("placeholder") ||
    lower.includes("blank") ||
    lower.endsWith(".svg")
  );
}

function normalizeCandidateImageUrl(raw: string, baseUrl: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/&amp;/g, "&");

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, key: string): string[] {
  const matches: string[] = [];
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, "gi"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["'][^>]*>`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[1]) matches.push(match[1]);
    }
  }

  return matches;
}

function collectJsonLdImages(input: unknown, out: string[]) {
  if (!input) return;
  if (typeof input === "string") {
    if (input.startsWith("http")) out.push(input);
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) collectJsonLdImages(item, out);
    return;
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (obj.image) collectJsonLdImages(obj.image, out);
    if (typeof obj.url === "string" && obj.url.startsWith("http") && String(obj["@type"] || "").toLowerCase().includes("image")) {
      out.push(obj.url);
    }
    for (const value of Object.values(obj)) {
      collectJsonLdImages(value, out);
    }
  }
}

function extractImageCandidatesFromHtml(html: string, pageUrl: string): string[] {
  const values = [
    ...extractMetaContent(html, "og:image"),
    ...extractMetaContent(html, "og:image:secure_url"),
    ...extractMetaContent(html, "twitter:image"),
    ...extractMetaContent(html, "twitter:image:src"),
    ...extractMetaContent(html, "image"),
  ];

  const jsonLdMatches = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      collectJsonLdImages(parsed, values);
    } catch {
      // ignore bad JSON-LD blocks
    }
  }

  const imgTagMatches = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)).slice(0, 8);
  for (const match of imgTagMatches) {
    values.push(match[1]);
  }

  const normalized = values
    .map((candidate) => normalizeCandidateImageUrl(candidate, pageUrl))
    .filter((u): u is string => !!u);

  return [...new Set(normalized)];
}

async function isUsableImageUrl(url: string, allowSpotifyHost = false): Promise<boolean> {
  if (!url) return false;
  if (isBlockedImageUrl(url)) return false;
  if (isLikelyLogoOrPlaceholder(url)) return false;

  const lower = url.toLowerCase();
  if (!allowSpotifyHost && lower.includes("i.scdn.co")) return false;

  try {
    let response = await fetchWithTimeout(url, { method: "HEAD" }, 8_000);
    if (!response.ok || response.status === 405) {
      response = await fetchWithTimeout(url, { method: "GET", headers: { Range: "bytes=0-1024" } }, 8_000);
    }

    if (!response.ok) return false;

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("image/")) return false;

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 0 && contentLength < 4_000) return false;

    return true;
  } catch {
    return false;
  }
}

async function scrapePageForImage(pageUrl: string, firecrawlKey: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        formats: ["html"],
        onlyMainContent: false,
      }),
    }, 18_000);

    if (!res.ok) return null;

    const data = await res.json();
    const html: string = data?.data?.html || data?.html || "";
    const candidates = extractImageCandidatesFromHtml(html, pageUrl);

    for (const candidate of candidates) {
      if (await isUsableImageUrl(candidate, false)) {
        return candidate;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function lookupSourcePageImage(
  sourceUrl: string | null,
  ticketUrl: string | null,
  firecrawlKey: string,
): Promise<string | null> {
  const urlsToTry = [ticketUrl, sourceUrl]
    .filter((u): u is string => !!u)
    .sort((a, b) => Number(isEventlyUrl(a)) - Number(isEventlyUrl(b)));

  for (const url of urlsToTry) {
    const image = await scrapePageForImage(url, firecrawlKey);
    if (image) return image;
    await delay(300);
  }

  return null;
}

async function lookupSearchImage(
  artist: string,
  venue: string,
  date: string,
  firecrawlKey: string,
): Promise<string | null> {
  const year = new Date(date).getUTCFullYear();
  const queries = [
    `${artist} official artist photo`,
    `${artist} ${year} live press photo`,
    `${artist} stockholm concert`,
  ];

  for (const query of queries) {
    try {
      const searchRes = await fetchWithTimeout("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit: 4 }),
      }, 15_000);

      if (!searchRes.ok) continue;

      const searchData = await searchRes.json();
      const results: Array<{ url?: string; link?: string; image?: string; thumbnail?: string }> =
        (Array.isArray(searchData?.data) ? searchData.data : []) ||
        (Array.isArray(searchData?.results) ? searchData.results : []);

      for (const result of results.slice(0, 3)) {
        const directImage = result.image || result.thumbnail;
        if (directImage && await isUsableImageUrl(directImage, false)) {
          return directImage;
        }

        const resultUrl = result.url || result.link;
        if (!resultUrl) continue;

        const scraped = await scrapePageForImage(resultUrl, firecrawlKey);
        if (scraped) return scraped;
      }
    } catch {
      // continue
    }
  }

  return null;
}

function cleanArtistForLookup(artist: string): string {
  return artist.split(/[:\-–—|(]/)[0].trim();
}

function hasHighConfidenceArtistMatch(inputArtist: string, spotifyArtist: string): boolean {
  const input = normalizeText(inputArtist);
  const candidate = normalizeText(spotifyArtist);

  if (!input || !candidate) return false;
  if (input === candidate) return true;

  const inputTokens = input.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (!inputTokens.length || !candidateTokens.length) return false;

  if (inputTokens[0] !== candidateTokens[0]) return false;

  const common = inputTokens.filter((token) => candidateTokens.includes(token)).length;
  const inputCoverage = common / inputTokens.length;
  const candidateCoverage = common / candidateTokens.length;

  return inputCoverage >= 0.8 && candidateCoverage >= 0.6;
}

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }, 10_000);

    if (!res.ok) return null;
    const data = await res.json();

    if (data.access_token) {
      spotifyToken = data.access_token;
      spotifyTokenExpiry = Date.now() + Math.max((data.expires_in - 60) * 1000, 60_000);
      return spotifyToken;
    }

    return null;
  } catch {
    return null;
  }
}

async function lookupSpotifyImage(artist: string): Promise<string | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const cleanName = cleanArtistForLookup(artist);
  try {
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanName)}&type=artist&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } },
      10_000,
    );

    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.artists?.items || [];

    for (const item of items) {
      if (!hasHighConfidenceArtistMatch(cleanName, item?.name || "")) continue;
      const images = item?.images || [];
      if (!images.length) continue;

      const best = images.find((img: { width?: number }) => img.width === 640) || images[0];
      if (!best?.url) continue;

      if (await isUsableImageUrl(best.url, true)) {
        return best.url;
      }
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const cursorId = typeof body.cursorId === "string" && body.cursorId.length > 0 ? body.cursorId : null;
    const chain = body.chain !== false;
    const batchSizeRaw = Number(body.batchSize ?? DEFAULT_BATCH_SIZE);
    const batchSize = Number.isFinite(batchSizeRaw)
      ? Math.max(1, Math.min(100, Math.trunc(batchSizeRaw)))
      : DEFAULT_BATCH_SIZE;

    let query = supabase
      .from("concerts")
      .select("id, artist, venue, date, image_url, source_url, ticket_url")
      .gte("date", new Date().toISOString())
      .or("source_url.ilike.%evently.se%,image_url.is.null,image_url.ilike.%data:image%,image_url.ilike.%example.com%,image_url.ilike.%widget-launcher.imbox.io%,image_url.ilike.%konserthuset.se/globalassets%,image_url.ilike.%id-preview--%,image_url.ilike.%lovable.app%,image_url.ilike.%evently.se/img/%,image_url.ilike.%evently.se/api/file%,image_url.ilike.%i.scdn.co%,image_url.ilike.%placeholder%,image_url.ilike.%blank%")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (cursorId) query = query.gt("id", cursorId);

    const { data: concerts, error } = await query;

    if (error) throw error;
    if (!concerts || concerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Done. No more images to refresh.", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Batch cursor=${cursorId ?? "start"}: ${concerts.length} concerts with missing/invalid images`);

    const startTime = Date.now();
    const spotifyCache = new Map<string, string | null>();
    let lastCursorId: string | null = cursorId;
    let processed = 0;
    let updated = 0;
    let sourceHits = 0;
    let searchHits = 0;
    let spotifyHits = 0;
    let unresolved = 0;
    let cleared = 0;
    let timedOut = false;

    for (const concert of concerts) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true;
        console.log("Time budget exceeded, chaining from last processed cursor");
        break;
      }

      processed++;
      lastCursorId = concert.id;

      const forceRefresh = isEventlyUrl(concert.source_url);
      if (!forceRefresh && !needsImageRefresh(concert.image_url)) {
        continue;
      }

      let imageUrl: string | null = null;

      if (firecrawlKey) {
        imageUrl = await lookupSourcePageImage(concert.source_url, concert.ticket_url, firecrawlKey);
        if (imageUrl) {
          sourceHits++;
        }
      }

      if (!imageUrl && firecrawlKey) {
        imageUrl = await lookupSearchImage(concert.artist, concert.venue, concert.date, firecrawlKey);
        if (imageUrl) {
          searchHits++;
        }
      }

      if (!imageUrl) {
        const cacheKey = normalizeText(cleanArtistForLookup(concert.artist));
        if (spotifyCache.has(cacheKey)) {
          imageUrl = spotifyCache.get(cacheKey) ?? null;
        } else {
          imageUrl = await lookupSpotifyImage(concert.artist);
          spotifyCache.set(cacheKey, imageUrl);
        }

        if (imageUrl) spotifyHits++;
      }

      if (imageUrl) {
        const { error: updateError } = await supabase
          .from("concerts")
          .update({ image_url: imageUrl })
          .eq("id", concert.id);

        if (updateError) {
          unresolved++;
          console.error(`Failed to update image for ${concert.artist}:`, updateError.message);
        } else {
          updated++;
        }
      } else {
        if (concert.image_url !== null && needsImageRefresh(concert.image_url)) {
          const { error: clearError } = await supabase
            .from("concerts")
            .update({ image_url: null })
            .eq("id", concert.id);

          if (clearError) {
            unresolved++;
            console.error(`Failed to clear image for ${concert.artist}:`, clearError.message);
          } else {
            cleared++;
          }
        } else {
          unresolved++;
        }
      }

      await delay(250);
    }

    const message = `Batch cursor=${cursorId ?? "start"}: processed ${processed}/${concerts.length}, updated ${updated} (source: ${sourceHits}, search: ${searchHits}, spotify: ${spotifyHits}), cleared ${cleared}, unresolved ${unresolved}`;
    console.log(message);

    const hasMore = !!lastCursorId && processed > 0 && (timedOut || concerts.length === batchSize);
    const shouldChain = chain && hasMore;

    if (shouldChain) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
      fetchWithTimeout(`${supabaseUrl}/functions/v1/fetch-images`, {
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
        sourceHits,
        searchHits,
        spotifyHits,
        cleared,
        unresolved,
        nextCursorId: hasMore ? lastCursorId : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("fetch-images error:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
