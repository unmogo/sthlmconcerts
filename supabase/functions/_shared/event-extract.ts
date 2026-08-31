export const TICKET_SELLER_DOMAINS = [
  "secure.tickster.com", "tickster.com",
  "ticketmaster.se", "ticketmaster.com", "livenation.se", "livenation.com",
  "eventim.se", "nortic.se", "billetto.se", "billetto.com", "dice.fm",
  "eventbrite.com", "eventbrite.se", "kulturbiljetter.se", "ticketco.events",
  "axs.com", "ra.co", "debaser.se", "fasching.se", "nalen.com",
  "konserthuset.se", "sodrateatern.com", "gronalund.com", "stockholmlive.com",
];

const REDIRECT_HOSTS = ["evyy.net", "ffrk.se", "evently.se"];
const URL_RE = /https?:\/\/[^\s)\]>"']+/gi;
const BLOCKED_APP_HOSTS = ["lovable.app", "id-preview--"];

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

export function absoluteUrl(raw: string, base: string): string | null {
  try {
    return new URL(decodeHtml(raw), base).toString();
  } catch {
    return null;
  }
}

function decodeMaybe(value: string): string {
  let decoded = decodeHtml(value.trim());
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
  return TICKET_SELLER_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`) || hostname.includes(domain));
}

export function normalizeExternalUrl(rawUrl: string | null | undefined, baseUrl?: string): string | null {
  const raw = decodeHtml(rawUrl ?? "").trim();
  if (!raw || /^(https?:?)$/i.test(raw)) return null;
  try {
    const parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    // Reject hosts that came out of a broken string rewrite (e.g. "\\g<1>800.webp")
    // or that simply aren't valid domains.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    if (BLOCKED_APP_HOSTS.some((blocked) => host.includes(blocked))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isTicketSellerUrl(url: string | null | undefined): boolean {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return false;
  try {
    return isSellerHost(new URL(normalized).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Aggregators are great discovery surfaces but must never be the final ticket
// destination (they are competitors and their pages are not checkout pages).
const AGGREGATOR_HOSTS = [
  "evently.se", "livespot.se", "evenemangskollen.se", "songkick.com", "bandsintown.com",
];

export function isAggregatorUrl(url: string | null | undefined): boolean {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// A ticket URL is usable when it points off-aggregator: either a known seller
// (tickster, ticketmaster, axs, …) or the venue's own booking page. Restricting
// to the seller allowlist was why perfectly good LiveSpot/venue links were
// dropped and the event ended up marked TBA.
export function isUsableTicketUrl(url: string | null | undefined): boolean {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return false;
  if (isAggregatorUrl(normalized)) return false;
  return /^https?:\/\//i.test(normalized);
}



export function extractTicketUrl(rawUrl: string): string | null {
  const decodedInput = decodeMaybe(rawUrl);
  if (!decodedInput || /^(https?:?)$/i.test(decodedInput.trim())) return null;
  try {
    const parsed = new URL(decodedInput);
    const hostname = parsed.hostname.toLowerCase();
    if (isSellerHost(hostname)) return parsed.toString();

    if (REDIRECT_HOSTS.some((host) => hostname.includes(host))) {
      for (const param of ["u", "url", "redirect", "target", "dest", "destination"]) {
        const target = parsed.searchParams.get(param);
        if (!target) continue;
        const extracted = extractTicketUrl(target);
        if (extracted) return extracted;
      }
    }
  } catch {
    // fall through to encoded URL scan
  }

  const encoded = decodedInput.match(/https?%3A%2F%2F[^\s"'&)<>]+/i)?.[0];
  if (encoded) return extractTicketUrl(encoded);
  const direct = decodedInput.match(URL_RE)?.[0];
  return direct && direct !== decodedInput ? extractTicketUrl(direct) : null;
}

export function extractTicketUrlFromHtml(html: string): string | null {
  const hrefs = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => decodeHtml(m[1]));
  const urls = html.match(URL_RE) ?? [];
  for (const candidate of [...hrefs, ...urls]) {
    const extracted = extractTicketUrl(candidate);
    if (extracted) return extracted;
  }
  return null;
}

export function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byName = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const byContent = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"));
  return decodeHtml(byName?.[1] ?? byContent?.[1] ?? "") || null;
}

export function isBadImageUrl(url: string | null | undefined): boolean {
  const lower = (url ?? "").toLowerCase();
  if (!lower) return true;
  return /evently\.se\/img\/event\.jpg|map-placeholder|staticmap|maps\.tickster\.com|maps\/api|google\.com\/maps|googleapis\.com\/maps/.test(lower)
    || /fallback-art|placeholder|sports-photographer|sport[s-]|venue-map|\/logo\.|tickster_logo|favicon|apple-touch-icon/.test(lower)
    || /facebook\.com|graph\.facebook\.com|fbcdn\.net|ytimg\.com|imdb\.|tmdb\.|themoviedb|m\.media-amazon\.com|gray-wcsc-prod\.gtv-cdn\.com/.test(lower)
    || /gettyimages\.com|alamy\.com|shutterstock\.com|depositphotos\.com/.test(lower)
    || /wikimedia\.org\/wikipedia\/commons\/thumb/.test(lower);
}

// Rewrites known CDN URLs to their highest-resolution variant. This is the main
// fix for pixelated cards: e.g. Ticketmaster's EVENT_DETAIL_PAGE crop is 205x115.
export function upgradeImageUrl(url: string | null | undefined): string | null {
  const clean = normalizeExternalUrl(url);
  if (!clean) return null;
  let out = clean;

  // Ticketmaster / Live Nation DAM: swap the small crop for the 2048x1152 one.
  out = out.replace(
    /_(EVENT_DETAIL_PAGE|SOURCE|CUSTOM|RECOMENDATION_16_9|RETINA_PORTRAIT|TABLET_LANDSCAPE|ARTIST_PAGE)(_16_9|_3_2)?\.(jpg|jpeg|png|webp)/i,
    "_TABLET_LANDSCAPE_LARGE_16_9.$3",
  );

  // Tickster CDN resize params.
  if (/static\.tickster\.com\/cdn-cgi\/image\//i.test(out)) {
    out = out.replace(/width=\d+/i, "width=960").replace(/height=\d+/i, "height=540");
  }

  // Livespot serves /<size>.webp derivatives; 800 is the largest available.
  out = out.replace(/(livespot\.se\/img\/[0-9a-f]{8,}\/)\d+(\.(?:webp|jpg|jpeg|png))/i, "$1800$2");

  // Live Nation dynamic media: force a large render.
  if (/dynamicmedia\.livenationinternational\.com/i.test(out)) {
    out = out.replace(/width=\d+/i, "width=1920").replace(/quality=\d+/i, "quality=90");
  }

  // RA imgproxy wraps a base64 original at quality:66 — use the original instead.
  const raProxy = out.match(/imgproxy\.ra\.co\/_\/[^/]*\/([A-Za-z0-9_-]{16,}=*)$/);
  if (raProxy) {
    const original = decodeBase64Url(raProxy[1]);
    if (original && /^https:\/\/images\.ra\.co\//i.test(original)) out = original;
  }

  return out;
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

export function isLowQualityImageUrl(url: string | null | undefined): boolean {
  const lower = (url ?? "").toLowerCase();
  const ticksterWidth = lower.match(/static\.tickster\.com\/cdn-cgi\/image\/[^/]*width=(\d+)/)?.[1];
  if (ticksterWidth && Number(ticksterWidth) < 700) return true;
  if (/_event_detail_page(_16_9)?\.(jpg|jpeg|png|webp)/.test(lower)) return true;
  if (/livespot\.se\/img\/[0-9a-f]{8,}\/[1-4]?\d{1,2}\./.test(lower)) return true;
  return /\/teaser\/222x222\/|[\/_-]222x222|width=(1\d\d|2\d\d|3\d\d)\b|height=(1\d\d|2\d\d|3\d\d)\b/.test(lower);
}


export function goodImageUrl(url: string | null | undefined): string | null {
  const clean = upgradeImageUrl(url);
  return clean && !isBadImageUrl(clean) ? clean : null;
}

export function extractEventImageUrl(html: string, baseUrl: string): string | null {
  const raw = extractMetaContent(html, "og:image") ?? extractMetaContent(html, "twitter:image");
  const abs = raw ? absoluteUrl(raw, baseUrl) : null;
  return goodImageUrl(abs);
}

export function extractBestImageUrlFromHtml(html: string, baseUrl: string): string | null {
  const candidates = new Set<string>();
  const meta = extractMetaContent(html, "og:image") ?? extractMetaContent(html, "twitter:image");
  if (meta) candidates.add(meta);
  for (const match of html.matchAll(/<(?:img|source)[^>]+(?:src|data-src|srcset)=['"]([^'"]+)['"]/gi)) {
    for (const part of match[1].split(",")) candidates.add(part.trim().split(/\s+/)[0]);
  }
  for (const match of html.matchAll(/https?:\/\/static\.tickster\.com\/cdn-cgi\/image\/[^\s"'<>\\)]+/gi)) candidates.add(match[0]);
  const ranked = [...candidates]
    .map((raw) => goodImageUrl(absoluteUrl(raw, baseUrl)))
    .filter((url): url is string => !!url)
    .sort((a, b) => imageScore(b) - imageScore(a));
  return ranked[0] ?? null;
}

function imageScore(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (/static\.tickster\.com\/cdn-cgi\/image/.test(lower)) score += 80;
  if (/eventim\.se\/obj\/media\/.*(?:1240x480|leaderboard|artwork)/.test(lower)) score += 70;
  if (/width=960|1240x480|1001x160/.test(lower)) score += 30;
  if (isLowQualityImageUrl(lower)) score -= 60;
  return score;
}

export function extractJsonLd(html: string): unknown[] {
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const out: unknown[] = [];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignore malformed structured data
    }
  }
  return out;
}

export type JsonLdEvent = {
  type: string;
  name: string;
  startDate: string;
  venue: string;
  locality: string;
  image: string | null;
  offerUrl: string | null;
  description: string;
};

// Most modern ticketing/venue/aggregator pages ship schema.org Event data.
// Parsing it deterministically is faster, cheaper and far more accurate than
// asking a model to read a markdown dump.
export function parseJsonLdEvents(html: string, baseUrl: string): JsonLdEvent[] {
  const out: JsonLdEvent[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o["@graph"])) walk(o["@graph"]);
    const type = String(Array.isArray(o["@type"]) ? o["@type"][0] : o["@type"] ?? "");
    if (!/Event$/i.test(type) && type !== "Festival") return;
    const loc = (o.location ?? {}) as Record<string, unknown>;
    const address = (loc.address ?? {}) as Record<string, unknown>;
    const img = o.image;
    const rawImage = typeof img === "string"
      ? img
      : Array.isArray(img)
        ? (typeof img[0] === "string" ? img[0] : String((img[0] as Record<string, unknown>)?.url ?? ""))
        : String((img as Record<string, unknown>)?.url ?? "");
    const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
    const offerUrl = normalizeExternalUrl(String((offers as Record<string, unknown>)?.url ?? ""), baseUrl);
    out.push({
      type,
      name: stripTags(String(o.name ?? "")),
      startDate: String(o.startDate ?? ""),
      venue: stripTags(String(loc.name ?? "")),
      locality: stripTags(String(address.addressLocality ?? "")),
      image: goodImageUrl(rawImage ? absoluteUrl(rawImage, baseUrl) : null),
      offerUrl,
      description: stripTags(String(o.description ?? "")).slice(0, 1000),
    });
  };
  for (const parsed of extractJsonLd(html)) walk(parsed);
  return out;
}
