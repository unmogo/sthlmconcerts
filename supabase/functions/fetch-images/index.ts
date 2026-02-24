import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simple MD5 hash for Wikimedia Commons file paths
async function md5Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("MD5", data).catch(() => null);
  if (hashBuffer) {
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(32, "0");
}

async function lookupArtistImage(artist: string): Promise<string | null> {
  const cleanName = artist.split(/[:\-–—|(]/)[0].trim();

  try {
    // Step 1: Search MusicBrainz for the artist
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(cleanName)}&limit=1&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const mbData = await mbRes.json();
    const mbArtist = mbData?.artists?.[0];
    if (!mbArtist?.id) return null;

    // Step 2: Get Wikidata relation
    await delay(1100); // MusicBrainz rate limit: 1 req/sec
    const relRes = await fetch(
      `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`,
      { headers: { "User-Agent": "SthlmConcerts/1.0 (contact@sthlmconcerts.app)" } }
    );
    const relData = await relRes.json();
    const relations = relData?.relations || [];

    const wikidataRel = relations.find((r: any) => r.type === "wikidata");
    if (wikidataRel?.url?.resource) {
      const wikidataId = wikidataRel.url.resource.split("/").pop();
      const wdRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`
      );
      const wdData = await wdRes.json();
      const imageName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageName) {
        const filename = encodeURIComponent(imageName.replace(/ /g, "_"));
        const md5 = await md5Hash(imageName.replace(/ /g, "_"));
        return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${filename}/500px-${filename}`;
      }
    }

    // Fallback: iTunes album art
    const itunesRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`
    );
    const itunesData = await itunesRes.json();
    const artworkUrl = itunesData?.results?.[0]?.artworkUrl100;
    if (artworkUrl) {
      return artworkUrl.replace("100x100", "600x600");
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
    let failed = 0;

    for (const concert of concerts) {
      const cacheKey = concert.artist.split(/[:\-–—|(]/)[0].trim().toLowerCase();

      let imageUrl: string | null;
      if (artistCache.has(cacheKey)) {
        imageUrl = artistCache.get(cacheKey)!;
      } else {
        if (artistCache.size > 0) await delay(1200); // MusicBrainz rate limit
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
