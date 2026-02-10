import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action } = body;

    // DELETE
    if (action === "delete" && Array.isArray(body.ids) && body.ids.length > 0) {
      const { error } = await supabase.from("concerts").delete().in("id", body.ids);
      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, message: `Deleted ${body.ids.length} events` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // UPDATE
    if (action === "update" && body.id && body.updates) {
      const { error } = await supabase.from("concerts").update(body.updates).eq("id", body.id);
      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, message: "Event updated" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // INSERT
    if (action === "insert" && body.concert) {
      const { error } = await supabase.from("concerts").insert({
        artist: body.concert.artist,
        venue: body.concert.venue,
        date: body.concert.date,
        ticket_url: body.concert.ticket_url || null,
        image_url: body.concert.image_url || null,
        event_type: body.concert.event_type || "concert",
        source: "manual",
        source_url: body.concert.ticket_url || null,
      });
      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, message: "Event added" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SCRAPE URL - scrape a single URL and extract event info
    if (action === "scrape-url" && body.url) {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!firecrawlKey || !lovableApiKey) {
        return new Response(
          JSON.stringify({ success: false, message: "API keys not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Scrape the URL
      const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: body.url,
          formats: ["markdown"],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeRes.json();
      const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";

      if (!markdown) {
        return new Response(
          JSON.stringify({ success: false, message: "Could not scrape page" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract with AI
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
              content: `Extract ONE event from this page. Return a JSON object with: artist (clean name, no tour subtitle), venue (short name), date (ISO 8601, year 2026 if ambiguous, default time 19:00), ticket_url, image_url, event_type ("concert" or "comedy"). Return ONLY valid JSON object.`,
            },
            {
              role: "user",
              content: `URL: ${body.url}\n\n${markdown.substring(0, 15000)}`,
            },
          ],
          temperature: 0.1,
        }),
      });

      const aiData = await aiRes.json();
      const content = aiData?.choices?.[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return new Response(
          JSON.stringify({ success: false, message: "Could not parse event" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const concert = JSON.parse(jsonMatch[0]);
      return new Response(
        JSON.stringify({ success: true, concert }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, message: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("manage-concerts error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
