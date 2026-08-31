// Source definitions: each describes how to scrape a listing into EventDrafts.
// Listing pages → markdown → AI structured extraction.
import { scrapeHtml, scrapeMarkdown } from "./firecrawl.ts";
import { AiClient, EVENT_DRAFT_SCHEMA, type EventDraft } from "./ai.ts";
import { extractMetaContent, extractTicketUrlFromHtml, goodImageUrl, isUsableTicketUrl, normalizeExternalUrl, parseJsonLdEvents, stripTags } from "./event-extract.ts";

export type SourceDef = {
  name: string;
  url: string;
  default_event_type: "concert" | "comedy";
  waitFor?: number;
  source_label: string;
};

export const SOURCES: SourceDef[] = [
  // RA first: it's deterministic + cheap (no AI) and historically got cut off by
  // earlier sources rate-limiting the AI gateway.
  {
    name: "ra-stockholm",
    url: "https://ra.co/events/se/stockholm?page=1",
    default_event_type: "concert",
    source_label: "ra.co",
    waitFor: 2500,
  },
  {
    name: "evently-music",
    url: "https://evently.se/en/place/se/stockholm?categories=music&page=1",
    default_event_type: "concert",
    source_label: "evently.se",
    waitFor: 1500,
  },
  {
    name: "evently-standup",
    url: "https://evently.se/en/place/se/stockholm?categories=standup&page=1",
    default_event_type: "comedy",
    source_label: "evently.se",
    waitFor: 1500,
  },
  {
    name: "livespot-konsert",
    url: "https://livespot.se/evenemang/stockholm/konsert",
    default_event_type: "concert",
    source_label: "livespot.se",
  },
  {
    name: "livespot-humor",
    url: "https://livespot.se/evenemang/stockholm/humor",
    default_event_type: "comedy",
    source_label: "livespot.se",
  },
  {
    name: "cirkus",
    url: "https://cirkus.se/sv/evenemang/",
    default_event_type: "concert",
    source_label: "cirkus.se",
    waitFor: 2000,
  },
  {
    name: "eventim-music",
    url: "https://www.eventim.se/events/musik-17/",
    default_event_type: "concert",
    source_label: "eventim.se",
    waitFor: 2000,
  },
  {
    name: "eventim-comedy",
    url: "https://www.eventim.se/events/komedi-169/",
    default_event_type: "comedy",
    source_label: "eventim.se",
    waitFor: 2000,
  },

];

const MONTHS: Record<string, string> = {
  jan: "01", "jan.": "01", januari: "01", feb: "02", "feb.": "02", februari: "02",
  mar: "03", "mars": "03", may: "05", oct: "10", apr: "04", "apr.": "04", april: "04", maj: "05",
  jun: "06", "juni": "06", jul: "07", "juli": "07", aug: "08", "aug.": "08", augusti: "08",
  sep: "09", "sep.": "09", september: "09", okt: "10", "okt.": "10", oktober: "10",
  nov: "11", "nov.": "11", november: "11", dec: "12", "dec.": "12", december: "12",
};

const SYSTEM = [
  "You extract upcoming live event listings from a markdown dump of a Stockholm listings page.",
  "Return only events that are concerts (live music) or stand-up comedy. Skip theater, sports, kids shows, museum events, and exhibitions.",
  "Each event must include a source_url (the detail page URL on the same site).",
  "Use ISO 8601 with timezone Europe/Stockholm for date_iso (e.g. 2026-07-27T18:00:00+02:00). Empty string if unknown.",
  "Do not invent venues or dates. Empty string for unknown fields.",
].join(" ");

// `deadline` is an absolute epoch-ms budget: every multi-page loop checks it and
// returns what it has instead of running until the edge runtime kills the job.
export async function fetchSource(
  ai: AiClient,
  src: SourceDef,
  deadline: number = Date.now() + 200_000,
): Promise<EventDraft[]> {
  // LiveSpot is server-rendered with full schema.org data on every event page —
  // no Firecrawl, no AI, and it yields the real seller link + poster.
  if (src.name.startsWith("livespot-")) return fetchLivespot(src, deadline);
  if (src.name === "cirkus") return fetchCirkus(src, deadline);
  const md = await scrapeMarkdown(src.url, { waitFor: src.waitFor });
  if (!md || md.length < 200) return [];
  if (src.name.startsWith("eventim-")) return fetchEventimStockholm(src, md, deadline);
  if (src.name === "ra-stockholm") return fetchRaStockholm(src, md, deadline);

  // Cap markdown to keep AI context small
  const trimmed = md.length > 60_000 ? md.slice(0, 60_000) : md;

  const out = await ai.json<{ events: EventDraft[] }>({
    system: SYSTEM,
    user: `Source: ${src.source_label}\nDefault event_type: ${src.default_event_type}\n\n--- PAGE MARKDOWN ---\n${trimmed}`,
    schema: EVENT_DRAFT_SCHEMA,
    name: "extract_events",
  });

  // Normalize and tag
  return (out.events ?? [])
    .filter((e) => e.artist && e.source_url)
    .map((e) => ({
      ...e,
      event_type: e.event_type === "comedy" ? "comedy" : "concert",
      // Resolve relative URLs
      source_url: e.source_url.startsWith("http")
        ? e.source_url
        : new URL(e.source_url, src.url).toString(),
    }));
}

async function fetchEventimStockholm(src: SourceDef, cityMarkdown: string, deadline: number): Promise<EventDraft[]> {
  const links = Array.from(cityMarkdown.matchAll(/\]\((https:\/\/www\.eventim\.se\/(?:artist|eventseries)\/[^)\s"]+)/g))
    .map((m) => m[1])
    .filter((url, i, arr) => arr.indexOf(url) === i)
    .slice(0, 60);

  const out: EventDraft[] = [];
  for (const link of links) {
    if (Date.now() > deadline) break;
    try {
      const artistMarkdown = await scrapeMarkdown(link, { waitFor: 1200, timeoutMs: 25_000 });
      out.push(...extractEventimArtistEvents(artistMarkdown, link, src.default_event_type));
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      // Keep the scraper moving if one Eventim artist page fails.
    }
  }
  return out;
}


function extractEventimArtistEvents(md: string, artistPageUrl: string, eventType: "concert" | "comedy"): EventDraft[] {
  const lines = md.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") || "";
  const hero = goodImageUrl(md.match(/!\[[^\]]*\]\((https:\/\/www\.eventim\.se\/obj\/media\/[^)\s]+)/)?.[1]);
  const drafts: EventDraft[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const linkMatch = lines[i].match(/\[(?:Köp biljetter|[^\]]+)\]\((https:\/\/www\.eventim\.se\/event\/[^)\s"]+)/);
    if (!linkMatch) continue;
    const sourceUrl = normalizeExternalUrl(linkMatch[1]);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    const window = lines.slice(Math.max(0, i - 22), i + 3);
    const cityIdx = window.findLastIndex((line) => /^##\s+STOCKHOLM$/i.test(line));
    if (cityIdx < 0) continue;

    const parsedDate = parseEventimDate(window);
    if (!parsedDate) continue;
    const venue = window.slice(cityIdx + 1).find((line) => /^-\s+/.test(line) && !/SEK|Från|Jimmy|Köp biljetter/i.test(line))?.replace(/^-\s+/, "") || "";
    const linkedTitle = lines[i].match(/"([^"]+)"/)?.[1] || title;
    drafts.push({
      artist: linkedTitle || title,
      venue_raw: venue,
      address_raw: "Stockholm",
      date_iso: parsedDate,
      ticket_url: sourceUrl,
      source_url: sourceUrl,
      image_url: hero ?? "",
      event_type: eventType,
    });
    seen.add(sourceUrl);
  }
  return drafts;
}

function parseEventimDate(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 2; i--) {
    const time = lines[i].match(/\b(\d{1,2}):(\d{2})\b/);
    const monthYear = lines[i - 1].match(/^([a-zåäö.]+)\s+(20\d{2})$/i);
    const day = lines[i - 2].match(/^(\d{1,2})$/);
    if (!time || !monthYear || !day) continue;
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (!month) continue;
    const offset = Number(month) >= 4 && Number(month) <= 10 ? "+02:00" : "+01:00";
    return `${monthYear[2]}-${month}-${day[1].padStart(2, "0")}T${time[1].padStart(2, "0")}:${time[2]}:00${offset}`;
  }
  return null;
}

// RA (Resident Advisor) listing pages are highly structured — parse the markdown
// directly instead of paying an AI roundtrip per page. Paginate until the page
// shows "No results found" or contains no event links.
async function fetchRaStockholm(src: SourceDef, firstPageMd: string, deadline: number): Promise<EventDraft[]> {
  const baseUrl = "https://ra.co/events/se/stockholm";
  const seen = new Set<string>();
  const out: EventDraft[] = [];
  let page = 1;
  let md = firstPageMd;

  while (page <= 15 && Date.now() < deadline) {
    const hasResults = !/no results found/i.test(md)
      && /\]\(https:\/\/ra\.co\/events\/\d+/.test(md);
    if (!hasResults) break;

    for (const draft of parseRaListingMarkdown(md)) {
      if (seen.has(draft.source_url)) continue;
      seen.add(draft.source_url);
      out.push(draft);
    }

    page++;
    try {
      md = await scrapeMarkdown(`${baseUrl}?page=${page}`, { waitFor: src.waitFor, timeoutMs: 30_000 });
      if (!md || md.length < 200) break;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // Enrich events with image + description from their detail page, bounded by the
  // remaining time budget rather than a fixed count.
  for (const draft of out) {
    if (Date.now() > deadline) break;
    try {
      const detailMd = await scrapeMarkdown(draft.source_url, { waitFor: 1200, timeoutMs: 20_000 });
      const enriched = extractRaDetail(detailMd);
      if (enriched.image) draft.image_url = enriched.image;
      if (enriched.description) draft.description = enriched.description;
    } catch {
      // Best-effort enrichment; keep going.
    }
  }

  return out;
}


// Pulls the flyer image and short description from an RA event detail page.
function extractRaDetail(md: string): { image: string; description: string } {
  const imgMatch = md.match(
    /!\[[^\]]*\]\((https:\/\/imgproxy\.ra\.co\/[^)\s]+)\)/,
  );
  const image = imgMatch?.[1] ?? "";

  let description = "";
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // Descriptions usually appear as "- ❥ ..." or as the first prose block
    // after the Genres section.
    const m = lines[i].match(/^-\s*❥\s*(.+)/);
    if (m) {
      const collected = [m[1]];
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const t = lines[j].trim();
        if (!t || /^[+-]?\d/.test(t) || t.startsWith("-") || t.startsWith("##")) break;
        collected.push(t);
      }
      description = collected.join(" ").trim();
      break;
    }
  }
  return { image, description: description.slice(0, 1000) };
}

// RA listings group events under "### <Weekday>, <Day> <Month>" headings, each
// followed by event blocks with "### [Title](https://ra.co/events/ID)" and a
// "Location" line. Times aren't on the listing — default to 22:00 local for club
// nights so the date sorts correctly without misleading minute-level precision.
function parseRaListingMarkdown(md: string): EventDraft[] {
  const lines = md.split("\n");
  const drafts: EventDraft[] = [];
  let currentDate: { y: number; m: number; d: number } | null = null;
  const today = new Date();
  const thisYear = today.getUTCFullYear();
  const thisMonth = today.getUTCMonth() + 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateMatch = line.match(
      /###\s*\S*\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*(\d{1,2})\s+([A-Za-z]+)/i,
    );
    if (dateMatch) {
      const day = Number(dateMatch[1]);
      const monthName = dateMatch[2].toLowerCase().slice(0, 3);
      const monthMap: Record<string, number> = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };
      const month = monthMap[monthName];
      if (!month) continue;
      const year = month < thisMonth ? thisYear + 1 : thisYear;
      currentDate = { y: year, m: month, d: day };
      continue;
    }

    const eventMatch = line.match(
      /###\s+\[([^\]]+)\]\((https:\/\/ra\.co\/events\/\d+)\)/,
    );
    if (!eventMatch || !currentDate) continue;

    const title = eventMatch[1].trim();
    const sourceUrl = eventMatch[2];

    // Look ahead for the venue / location label.
    let venueRaw = "";
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      if (/###\s+\[/.test(lines[j])) break;
      if (/^\s*Location\s*$/.test(lines[j])) {
        for (let k = j + 1; k < Math.min(j + 8, lines.length); k++) {
          const t = lines[k].trim();
          if (!t) continue;
          const vmatch = t.match(/^\[([^\]]+)\]\(https:\/\/ra\.co\/clubs\//);
          if (vmatch) venueRaw = vmatch[1].trim();
          else if (!/^TBA/i.test(t)) venueRaw = t.replace(/^[-*]\s*/, "").trim();
          break;
        }
        break;
      }
    }

    if (!venueRaw) continue; // Skips TBA-only entries — invalid venue rule would drop them anyway.

    const iso = `${currentDate.y}-${String(currentDate.m).padStart(2, "0")}-${String(
      currentDate.d,
    ).padStart(2, "0")}T22:00:00${currentDate.m >= 4 && currentDate.m <= 10 ? "+02:00" : "+01:00"}`;

    drafts.push({
      artist: title,
      venue_raw: venueRaw,
      address_raw: "Stockholm",
      date_iso: iso,
      ticket_url: sourceUrl,
      source_url: sourceUrl,
      image_url: "",
      event_type: "concert",
    });
  }

  return drafts;
}


// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

// Plain fetch with a hard timeout. Used for sources that are server-rendered
// and don't need a headless browser — much faster and free of Firecrawl's
// shared rate limit.
async function getHtml(url: string, timeoutMs = 12_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; STHLMEventsBot/1.0; +https://sthlmevents.lovable.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Bounded-concurrency map that stops issuing new work past the deadline.
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  deadline: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length && Date.now() < deadline) {
      const item = items[cursor++];
      const result = await fn(item).catch(() => null);
      if (result) out.push(result);
    }
  });
  await Promise.all(workers);
  return out;
}

const NON_MUSIC_JSONLD_TYPES = [
  "TheaterEvent", "ScreeningEvent", "SportsEvent", "ExhibitionEvent",
  "ChildrensEvent", "EducationEvent", "BusinessEvent", "FoodEvent",
];

// ---------------------------------------------------------------------------
// LiveSpot
// ---------------------------------------------------------------------------

// LiveSpot's category page is server-rendered, and its React Router data
// endpoint (`<path>.data?page=N`) paginates through the full Stockholm list.
// Every event page carries schema.org data with the real seller URL in
// `offers.url` and the poster in `image.url`, so we never have to guess.
async function fetchLivespot(src: SourceDef, deadline: number): Promise<EventDraft[]> {
  const slugs = await harvestLivespotSlugs(src.url, deadline);
  if (!slugs.length) return [];

  const drafts = await mapPool(slugs, 6, deadline - 20_000, async (slug) => {
    const url = `https://livespot.se/event/${slug}`;
    const html = await getHtml(url);
    if (!html) return null;
    const events = parseJsonLdEvents(html, url);
    const event = events.find((e) => e.startDate && e.venue);
    if (!event) return null;
    if (NON_MUSIC_JSONLD_TYPES.includes(event.type)) return null;
    if (event.locality && !/stockholm/i.test(event.locality)) return null;

    const ticket = isUsableTicketUrl(event.offerUrl) ? event.offerUrl! : "";
    const image = event.image
      ?? goodImageUrl(extractMetaContent(html, "og:image"))
      ?? "";

    const draft: EventDraft = {
      artist: event.name || stripTags(extractMetaContent(html, "og:title") ?? ""),
      venue_raw: event.venue,
      address_raw: event.locality || "Stockholm",
      date_iso: event.startDate,
      ticket_url: ticket,
      source_url: url,
      image_url: image,
      description: event.description,
      event_type: event.type === "ComedyEvent" ? "comedy" : src.default_event_type,
    };
    return draft.artist ? draft : null;
  });

  return drafts;
}

async function harvestLivespotSlugs(listingUrl: string, deadline: number): Promise<string[]> {
  const slugs = new Set<string>();
  const collect = (text: string) => {
    let added = 0;
    for (const m of text.matchAll(/([a-z0-9]+(?:-[a-z0-9]+){1,12}-[0-9a-f]{8})(?![0-9a-f])/g)) {
      const slug = m[1];
      // Reject UUID fragments: a real slug has at least one segment with a
      // letter outside the hex alphabet.
      if (!/[g-z]/.test(slug.slice(0, -9))) continue;
      if (!slugs.has(slug)) { slugs.add(slug); added++; }
    }
    return added;
  };

  collect(await getHtml(listingUrl));

  let emptyPages = 0;
  for (let page = 1; page <= 60 && Date.now() < deadline - 60_000; page++) {
    const text = await getHtml(`${listingUrl}.data?page=${page}`, 15_000);
    if (!text) { emptyPages++; } else { emptyPages = collect(text) > 0 ? 0 : emptyPages + 1; }
    if (emptyPages >= 3) break;
  }

  return [...slugs];
}

// ---------------------------------------------------------------------------
// Cirkus (venue site)
// ---------------------------------------------------------------------------

// Cirkus blocks plain bots, so the listing and detail pages go through
// Firecrawl. Every show page links straight to its ticket vendor.
async function fetchCirkus(src: SourceDef, deadline: number): Promise<EventDraft[]> {
  const listing = await scrapeHtml(src.url, { waitFor: src.waitFor, timeoutMs: 40_000 });
  if (!listing) return [];
  const links = [...new Set(
    Array.from(listing.matchAll(/href=["'](?:https:\/\/cirkus\.se)?(\/(?:sv|en)\/evenemang\/[a-z0-9-]+\/?)["']/gi))
      .map((m) => `https://cirkus.se${m[1].replace(/\/en\//, "/sv/")}`),
  )].slice(0, 40);

  const drafts: EventDraft[] = [];
  for (const link of links) {
    if (Date.now() > deadline - 15_000) break;
    const html = await scrapeHtml(link, { waitFor: 1200, timeoutMs: 30_000 }).catch(() => "");
    if (!html) continue;
    drafts.push(...extractCirkusEvents(html, link, src.default_event_type));
  }
  return drafts;
}

function extractCirkusEvents(html: string, url: string, defaultType: "concert" | "comedy"): EventDraft[] {
  const title = stripTags(extractMetaContent(html, "og:title") ?? "").replace(/\s*[|–-]\s*Cirkus.*$/i, "").trim();
  const image = goodImageUrl(extractMetaContent(html, "og:image")) ?? "";
  const description = (extractMetaContent(html, "og:description") ?? "").slice(0, 1000);
  const ticketCandidate = extractTicketUrlFromHtml(html);
  const ticket = isUsableTicketUrl(ticketCandidate) ? ticketCandidate! : "";

  const structured = parseJsonLdEvents(html, url).filter(
    (e) => e.startDate && !NON_MUSIC_JSONLD_TYPES.includes(e.type),
  );
  if (structured.length) {
    return structured.map((e) => ({
      artist: e.name || title,
      venue_raw: e.venue || "Cirkus",
      address_raw: "Stockholm",
      date_iso: e.startDate,
      ticket_url: (isUsableTicketUrl(e.offerUrl) ? e.offerUrl! : ticket),
      source_url: url,
      image_url: e.image ?? image,
      description: e.description || description,
      event_type: e.type === "ComedyEvent" ? "comedy" : defaultType,
    }));
  }

  // No structured data: read the "DATE" table ("03 OCT 2026 … SAT 19:30").
  if (!title) return [];
  const text = stripTags(html);
  const out: EventDraft[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(
    /(\d{1,2})\s+([A-Za-zÅÄÖåäö.]{3,9})\s+(20\d{2})[^0-9]{0,40}?(\d{1,2})[:.](\d{2})/g,
  )) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2].toLowerCase()];
    if (!month) continue;
    const iso = `${m[3]}-${month}-${m[1].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}:00${
      Number(month) >= 4 && Number(month) <= 10 ? "+02:00" : "+01:00"
    }`;
    if (seen.has(iso)) continue;
    seen.add(iso);
    out.push({
      artist: title,
      venue_raw: "Cirkus",
      address_raw: "Stockholm",
      date_iso: iso,
      ticket_url: ticket,
      source_url: url,
      image_url: image,
      description,
      event_type: defaultType,
    });
  }
  return out;
}
