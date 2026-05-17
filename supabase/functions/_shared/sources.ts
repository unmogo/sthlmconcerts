// Source definitions: each describes how to scrape a listing into EventDrafts.
// Listing pages → markdown → AI structured extraction.
import { scrapeMarkdown } from "./firecrawl.ts";
import { AiClient, EVENT_DRAFT_SCHEMA, type EventDraft } from "./ai.ts";
import { goodImageUrl, normalizeExternalUrl } from "./event-extract.ts";

export type SourceDef = {
  name: string;
  url: string;
  default_event_type: "concert" | "comedy";
  waitFor?: number;
  source_label: string;
};

export const SOURCES: SourceDef[] = [
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
    url: "https://livespot.se/?city=stockholm&category=konsert",
    default_event_type: "concert",
    source_label: "livespot.se",
    waitFor: 2000,
  },
  {
    name: "livespot-humor",
    url: "https://livespot.se/?city=stockholm&category=humor",
    default_event_type: "comedy",
    source_label: "livespot.se",
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
  {
    name: "ra-stockholm",
    url: "https://ra.co/events/se/stockholm?page=1",
    default_event_type: "concert",
    source_label: "ra.co",
    waitFor: 2500,
  },
];

const MONTHS: Record<string, string> = {
  jan: "01", "jan.": "01", januari: "01", feb: "02", "feb.": "02", februari: "02",
  mar: "03", "mars": "03", apr: "04", "apr.": "04", april: "04", maj: "05",
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

export async function fetchSource(
  ai: AiClient,
  src: SourceDef,
): Promise<EventDraft[]> {
  const md = await scrapeMarkdown(src.url, { waitFor: src.waitFor });
  if (!md || md.length < 200) return [];
  if (src.name.startsWith("eventim-")) return fetchEventimStockholm(src, md);
  if (src.name === "ra-stockholm") return fetchRaStockholm(ai, src, md);
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

async function fetchEventimStockholm(src: SourceDef, cityMarkdown: string): Promise<EventDraft[]> {
  const links = Array.from(cityMarkdown.matchAll(/\]\((https:\/\/www\.eventim\.se\/(?:artist|eventseries)\/[^)\s"]+)/g))
    .map((m) => m[1])
    .filter((url, i, arr) => arr.indexOf(url) === i)
    .slice(0, 35);

  const out: EventDraft[] = [];
  for (const link of links) {
    try {
      const artistMarkdown = await scrapeMarkdown(link, { waitFor: 1200 });
      out.push(...extractEventimArtistEvents(artistMarkdown, link, src.default_event_type));
      await new Promise((r) => setTimeout(r, 250));
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

// RA (Resident Advisor) auto-paginates listing. Probe page=1..N until "No results found"
// or the page returns no event links, then ingest every page up to the last valid one.
async function fetchRaStockholm(ai: AiClient, src: SourceDef, firstPageMd: string): Promise<EventDraft[]> {
  const baseUrl = "https://ra.co/events/se/stockholm";
  const out: EventDraft[] = [];
  let page = 1;
  let md = firstPageMd;

  while (page <= 10) {
    const isEmpty = /no results found/i.test(md) || !/\]\(https:\/\/ra\.co\/events\/\d+/.test(md);
    if (isEmpty) break;

    const trimmed = md.length > 60_000 ? md.slice(0, 60_000) : md;
    try {
      const parsed = await ai.json<{ events: EventDraft[] }>({
        system: SYSTEM,
        user: `Source: ra.co (Stockholm page ${page})\nDefault event_type: concert\n\n--- PAGE MARKDOWN ---\n${trimmed}`,
        schema: EVENT_DRAFT_SCHEMA,
        name: "extract_events",
      });
      for (const e of parsed.events ?? []) {
        if (!e.artist || !e.source_url) continue;
        out.push({
          ...e,
          event_type: e.event_type === "comedy" ? "comedy" : "concert",
          source_url: e.source_url.startsWith("http")
            ? e.source_url
            : new URL(e.source_url, baseUrl).toString(),
        });
      }
    } catch {
      // Skip page on AI failure; try next.
    }

    page++;
    try {
      md = await scrapeMarkdown(`${baseUrl}?page=${page}`, { waitFor: src.waitFor });
      if (!md || md.length < 200) break;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}
