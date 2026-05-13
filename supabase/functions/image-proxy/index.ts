// Proxies images from sources that block hotlinking via CORP/CORS
// (notably evently.se which sets cross-origin-resource-policy: same-origin).
// Usage: GET /functions/v1/image-proxy?url=<encoded-url>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const ALLOWED_HOSTS = [
  "evently.se",
  "www.evently.se",
];

function guessContentType(url: string): string {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return new Response("Missing url", { status: 400, headers: corsHeaders });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: corsHeaders });
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return new Response("Host not allowed", { status: 403, headers: corsHeaders });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; STHLMConcertsImageProxy/1.0)",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return new Response(`Upstream ${upstream.status}`, { status: 502, headers: corsHeaders });
    }

    const upstreamType = upstream.headers.get("content-type") || "";
    const contentType = upstreamType && upstreamType !== "false" && upstreamType.startsWith("image/")
      ? upstreamType
      : guessContentType(parsed.pathname);

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (e) {
    return new Response(`Proxy error: ${(e as Error).message}`, { status: 502, headers: corsHeaders });
  }
});
