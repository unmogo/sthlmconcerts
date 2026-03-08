import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    console.error("Spotify token error:", data);
    return null;
  } catch (err) {
    console.error("Spotify auth failed:", err);
    return null;
  }
}

function isBadImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();

  return (
    lower.includes("example.com") ||
    lower.includes("widget-launcher.imbox.io") ||
    lower.includes("konserthuset.se/globalassets") ||
    lower.includes("localhost") ||
    lower.includes("lovable.app") ||
    lower.includes("id-preview--")
  );
}

// ==================== SPOTIFY IMAGE LOOKUP ====================

async function lookupSpotifyImage(artist: string): Promise<string | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanName)}&type=artist&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      console.error(`Spotify search failed for "${cleanName}": ${res.status}`);
      return null;
    }
    const data = await res.json();
    const images = data?.artists?.items?.[0]?.images;
    if (images && images.length > 0) {
      // Prefer 640px image, fallback to largest
      const best = images.find((img: any) => img.width === 640) || images[0];
      return best.url;
    }
    return null;
  } catch (err) {
    console.error(`Spotify lookup error for "${cleanName}":`, err);
    return null;
  }
}

// ==================== FALLBACK: MUSICBRAINZ → WIKIPEDIA → ITUNES ====================

async function lookupFallbackImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();

  try {
    // MusicBrainz → Wikidata → Wikipedia Commons
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(cleanName)}&limit=1&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const mbData = await mbRes.json();
    const mbArtist = mbData?.artists?.[0];
    if (!mbArtist?.id) return null;

    await delay(1100);
    const relRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const relData = await relRes.json();
    const wikidataRel = (relData?.relations || []).find((r: any) => r.type === "wikidata");
    
    if (wikidataRel?.url?.resource) {
      const wikidataId = wikidataRel.url.resource.split("/").pop();
      const wdRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`
      );
      const wdData = await wdRes.json();
      const imageName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageName) {
        const filename = encodeURIComponent(imageName.replace(/ /g, "_"));
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=500`;
      }
    }

    // iTunes fallback
    const itunesRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`
    );
    const itunesData = await itunesRes.json();
    const artworkUrl = itunesData?.results?.[0]?.artworkUrl100;
    if (artworkUrl) return artworkUrl.replace("100x100", "600x600");

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: concerts, error } = await supabase
      .from("concerts")
      .select("id, artist, event_type")
      .gte("date", new Date().toISOString())
      .is("image_url", null)
      .order("date", { ascending: true });

    if (error) throw error;
    if (!concerts || concerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No concerts with missing images", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${concerts.length} concerts with missing images`);

    const artistCache = new Map<string, string | null>();
    let updated = 0;
    let spotifyHits = 0;
    let fallbackHits = 0;
    let failed = 0;

    for (const concert of concerts) {
      const cacheKey = concert.artist.split(/[:\-–—|(]/)[0].trim().toLowerCase();

      let imageUrl: string | null;
      if (artistCache.has(cacheKey)) {
        imageUrl = artistCache.get(cacheKey)!;
      } else {
        // Try Spotify first
        imageUrl = await lookupSpotifyImage(concert.artist);
        if (imageUrl) {
          spotifyHits++;
        } else {
          // Fallback to MusicBrainz chain
          if (artistCache.size > 0) await delay(1200);
          imageUrl = await lookupFallbackImage(concert.artist);
          if (imageUrl) fallbackHits++;
        }
        artistCache.set(cacheKey, imageUrl);
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
      } else {
        failed++;
      }
    }

    const message = `Updated ${updated} images (Spotify: ${spotifyHits}, fallback: ${fallbackHits}), ${failed} not found, out of ${concerts.length} missing`;
    console.log(message);

    return new Response(
      JSON.stringify({ success: true, message, updated, spotifyHits, fallbackHits, failed, total: concerts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fetch-images error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
