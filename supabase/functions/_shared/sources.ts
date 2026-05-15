// Source definitions: each describes how to scrape a listing into EventDrafts.
// Listing pages → markdown → AI structured extraction.
import { scrapeMarkdown } from "./firecrawl.ts";
import { AiClient, EVENT_DRAFT_SCHEMA, type EventDraft } from "./ai.ts";

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
    name: "eventim-stockholm",
    url: "https://www.eventim.se/city/stockholm-12/",
    default_event_type: "concert",
    source_label: "eventim.se",
    waitFor: 2000,
  },
];

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
