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

export function upgradeImageUrl(url: string | null | undefined): string | null {
  const clean = normalizeExternalUrl(url);
  if (!clean) return null;
  if (/static\.tickster\.com\/cdn-cgi\/image\//i.test(clean)) {
    return clean
      .replace(/width=\d+/i, "width=960")
      .replace(/height=\d+/i, "height=540");
  }
  return clean;
}

export function isLowQualityImageUrl(url: string | null | undefined): boolean {
  const lower = (url ?? "").toLowerCase();
  const ticksterWidth = lower.match(/static\.tickster\.com\/cdn-cgi\/image\/[^/]*width=(\d+)/)?.[1];
  if (ticksterWidth && Number(ticksterWidth) < 700) return true;
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
