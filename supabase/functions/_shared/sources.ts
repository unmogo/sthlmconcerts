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

// `deadline` is an absolute epoch-ms budget: every multi-page loop checks it and
// returns what it has instead of running until the edge runtime kills the job.
export async function fetchSource(
  ai: AiClient,
  src: SourceDef,
  deadline: number = Date.now() + 200_000,
): Promise<EventDraft[]> {
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

