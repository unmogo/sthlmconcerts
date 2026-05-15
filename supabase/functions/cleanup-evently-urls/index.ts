// Edge function: scrape evently.se event pages and replace ticket_url with
// the real vendor URL (Ticketmaster, Tickster, Nortic, Billetto, Dice, etc.).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractTicketUrlFromHtml } from "../_shared/event-extract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VENDOR_HOST_RE =
  /(secure\.tickster\.com|tickster\.com|ticketmaster\.se|livenation\.se|nortic\.se|billetto\.[a-z.]+|dice\.fm|eventbrite\.[a-z.]+|tickethub\.[a-z.]+|ebillet\.dk|kulturbiljetter\.se|ticketco\.events)/i;

function extractVendorUrl(html: string): string | null {
  // 1. Affiliate wrapper: ticketmaster.evyy.net/...?u=<encoded>
  const aff = html.match(/https?:\/\/ticketmaster\.evyy\.net\/[^"'\s\\<>]+/gi) ?? [];
  for (const raw of aff) {
    const cleaned = raw.replace(/&amp;/g, "&");
    const m = cleaned.match(/[?&]u=([^&"'\s\\<>]+)/);
    if (m) {
      try {
        const decoded = decodeURIComponent(m[1]).split(/[\\"'\s<>]/)[0];
        if (decoded.startsWith("http") && VENDOR_HOST_RE.test(decoded)) return decoded;
      } catch { /* ignore */ }
    }
  }
  // 2. Any direct vendor link in the page
  const all = html.match(/https?:\/\/[^"'\s\\<>]+/g) ?? [];
  for (const url of all) {
    const cleaned = url.replace(/&amp;/g, "&");
    if (VENDOR_HOST_RE.test(cleaned)) return cleaned;
  }
  return null;
}

async function authedAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await anon.auth.getUser(auth.replace("Bearer ", ""));
  const uid = data?.user?.id;
  if (!uid) return false;
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await service.rpc("has_role", { _user_id: uid, _role: "admin" });
  return !!ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await authedAdmin(req))) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { limit = 50 } = await req.json().catch(() => ({}));

  const { data: rows, error } = await supabase
    .from("concerts")
    .select("id, ticket_url")
    .ilike("ticket_url", "%evently.se%")
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let updated = 0;
  let cleared = 0;
  let failed = 0;
  const results: Array<{ id: string; from: string; to: string | null }> = [];

  await Promise.all(
    (rows ?? []).map(async (r) => {
      try {
        const res = await fetch(r.ticket_url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; STHLMConcertsBot/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) {
          failed++;
          return;
        }
        const html = await res.text();
        const vendor = extractTicketUrlFromHtml(html) ?? extractVendorUrl(html);
        if (vendor) {
          await supabase.from("concerts").update({ ticket_url: vendor, tickets_available: true }).eq("id", r.id);
          updated++;
          results.push({ id: r.id, from: r.ticket_url, to: vendor });
        } else {
          // No real vendor — keep evently.se as fallback (still a working external link)
          cleared++;
          results.push({ id: r.id, from: r.ticket_url, to: null });
        }
      } catch (_e) {
        failed++;
      }
    }),
  );

  const { count: remaining } = await supabase
    .from("concerts")
    .select("id", { count: "exact", head: true })
    .ilike("ticket_url", "%evently.se%");

  return new Response(
    JSON.stringify({ processed: rows?.length ?? 0, updated, kept: cleared, failed, remaining, results: results.slice(0, 10) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
