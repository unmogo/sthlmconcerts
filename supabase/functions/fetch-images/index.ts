import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookupArtistImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();
  try {
    // Search for albums/tracks by the artist — musicArtist entity doesn't return artwork
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`
    );
    const data = await res.json();
    const artworkUrl = data?.results?.[0]?.artworkUrl100;
    if (artworkUrl) {
      return artworkUrl.replace("100x100", "600x600");
    }
    // Fallback: try musicTrack
    const res2 = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=musicTrack&limit=1`
    );
    const data2 = await res2.json();
    return data2?.results?.[0]?.artworkUrl100?.replace("100x100", "600x600") || null;
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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all concerts with missing images (future events only)
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

    // Deduplicate by artist to avoid redundant lookups
    const artistCache = new Map<string, string | null>();
    let updated = 0;
    let failed = 0;

    for (const concert of concerts) {
      const cacheKey = concert.artist.split(/[:\-–—|(]/)[0].trim().toLowerCase();

      let imageUrl: string | null;
      if (artistCache.has(cacheKey)) {
        imageUrl = artistCache.get(cacheKey)!;
      } else {
        // Small delay to avoid rate limiting iTunes API
        if (artistCache.size > 0) await delay(300);
        imageUrl = await lookupArtistImage(concert.artist);
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

    const message = `Updated ${updated} images, ${failed} not found, out of ${concerts.length} missing`;
    console.log(message);

    return new Response(
      JSON.stringify({ success: true, message, updated, failed, total: concerts.length }),
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
