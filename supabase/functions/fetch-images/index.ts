import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 30;
const TIME_BUDGET_MS = 240_000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ==================== BAD IMAGE CHECK ====================

function isBadImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("example.com") ||
    lower.includes("widget-launcher.imbox.io") ||
    lower.includes("konserthuset.se/globalassets") ||
    lower.includes("evently.se/api/file") ||
    lower.includes("evently.se/img/") ||
    lower.includes("i.scdn.co") ||
    lower.includes("localhost") ||
    lower.includes("lovable.app") ||
    lower.includes("id-preview--")
  );
}

// ==================== SOURCE PAGE IMAGE (PRIMARY) ====================

async function lookupSourcePageImage(
  sourceUrl: string | null,
  ticketUrl: string | null,
  firecrawlKey: string
): Promise<string | null> {
  // Try source_url first, then ticket_url
  const urlsToTry = [sourceUrl, ticketUrl].filter(
    (u): u is string => !!u && !u.includes("evently.se/img/")
  );

  for (const url of urlsToTry) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["html"],
          onlyMainContent: false,
        }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const html: string = data?.data?.html || data?.html || "";

      // Look for og:image meta tag first (most reliable)
      const ogMatch = html.match(
        /meta\s+(?:property|name)\s*=\s*["']og:image["']\s+content\s*=\s*["']([^"']+)["']/i
      ) || html.match(
        /content\s*=\s*["']([^"']+)["']\s+(?:property|name)\s*=\s*["']og:image["']/i
      );

      if (ogMatch?.[1] && !isBadImageUrl(ogMatch[1])) {
        return ogMatch[1];
      }

      // Also check twitter:image
      const twMatch = html.match(
        /meta\s+(?:property|name)\s*=\s*["']twitter:image["']\s+content\s*=\s*["']([^"']+)["']/i
      ) || html.match(
        /content\s*=\s*["']([^"']+)["']\s+(?:property|name)\s*=\s*["']twitter:image["']/i
      );

      if (twMatch?.[1] && !isBadImageUrl(twMatch[1])) {
        return twMatch[1];
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ==================== SPOTIFY AUTH ====================

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const data = await res.json();
    if (data.access_token) {
      spotifyToken = data.access_token;
      spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return spotifyToken;
    }
    return null;
  } catch {
    return null;
  }
}

// ==================== SPOTIFY IMAGE LOOKUP (FALLBACK) ====================

async function lookupSpotifyImage(artist: string): Promise<string | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanName)}&type=artist&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const images = data?.artists?.items?.[0]?.images;
    if (images && images.length > 0) {
      const best = images.find((img: { width: number }) => img.width === 640) || images[0];
      return best.url;
    }
    return null;
  } catch {
    return null;
  }
}

// ==================== MAIN ====================

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
    const offset = body.offset || 0;
    const chain = body.chain !== false;

    const { data: concerts, error } = await supabase
      .from("concerts")
      .select("id, artist, event_type, image_url, source_url, ticket_url")
      .gte("date", new Date().toISOString())
      .or("image_url.is.null,image_url.ilike.%example.com%,image_url.ilike.%widget-launcher.imbox.io%,image_url.ilike.%konserthuset.se/globalassets%,image_url.ilike.%id-preview--%,image_url.ilike.%lovable.app%,image_url.ilike.%evently.se/img/%,image_url.ilike.%i.scdn.co%")
      .order("date", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;
    if (!concerts || concerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: `Done. No more concerts from offset ${offset}`, updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Batch offset=${offset}: ${concerts.length} concerts with missing/invalid images`);

    const startTime = Date.now();
    const artistCache = new Map<string, string | null>();
    let updated = 0;
    let sourceHits = 0;
    let spotifyHits = 0;
    let failed = 0;

    for (const concert of concerts) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log("Time budget exceeded, will continue in next batch");
        break;
      }

      const cacheKey = concert.artist.split(/[:\-–—|(]/)[0].trim().toLowerCase();
      let imageUrl: string | null = null;

      // STEP 1: Try to get image from the source page (og:image)
      if (firecrawlKey && (concert.source_url || concert.ticket_url)) {
        imageUrl = await lookupSourcePageImage(concert.source_url, concert.ticket_url, firecrawlKey);
        if (imageUrl && !isBadImageUrl(imageUrl)) {
          sourceHits++;
        } else {
          imageUrl = null;
        }
        await delay(600);
      }

      // STEP 2: Fallback to Spotify (use cache)
      if (!imageUrl) {
        if (artistCache.has(cacheKey)) {
          imageUrl = artistCache.get(cacheKey)!;
        } else {
          imageUrl = await lookupSpotifyImage(concert.artist);
          if (imageUrl) spotifyHits++;
          if (isBadImageUrl(imageUrl)) imageUrl = null;
          artistCache.set(cacheKey, imageUrl);
        }
      }

      if (imageUrl) {
        const { error: updateError } = await supabase
          .from("concerts")
          .update({ image_url: imageUrl })
          .eq("id", concert.id);

        if (updateError) {
          console.error(`Failed to update ${concert.artist}:`, updateError.message);
          failed++;
        } else {
          updated++;
        }
      } else if (isBadImageUrl(concert.image_url)) {
        await supabase.from("concerts").update({ image_url: null }).eq("id", concert.id);
      } else {
        failed++;
      }
    }

    const message = `Batch offset=${offset}: updated ${updated} (source: ${sourceHits}, spotify: ${spotifyHits}), ${failed} unresolved, ${concerts.length} processed`;
    console.log(message);

    // Chain to next batch
    if (chain && concerts.length === BATCH_SIZE) {
      const nextOffset = offset + BATCH_SIZE;
      console.log(`Chaining to next batch at offset=${nextOffset}`);

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
      fetch(`${supabaseUrl}/functions/v1/fetch-images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ offset: nextOffset, chain: true }),
      }).catch((err) => console.error("Chain call failed:", err));
    }

    return new Response(
      JSON.stringify({ success: true, message, updated, sourceHits, spotifyHits, failed, total: concerts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fetch-images error:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
