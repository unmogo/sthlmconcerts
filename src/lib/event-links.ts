import { format } from "date-fns";
import type { Concert } from "@/types/concert";
import { parseLocalDate } from "@/lib/utils/concert-utils";

export const SITE_URL = "https://sthlmconcerts.lovable.app";

export function eventPath(concert: Pick<Concert, "id" | "slug">): string {
  return `/event/${concert.slug ?? concert.id}`;
}

export function eventCanonicalUrl(concert: Pick<Concert, "id" | "slug">): string {
  return `${SITE_URL}${eventPath(concert)}`;
}

/** Build a Google Calendar "render template" URL with TZ Europe/Stockholm. */
export function googleCalendarUrl(concert: Concert): string {
  const start = parseLocalDate(concert.date);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000); // assume 3h
  const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${concert.artist} — ${concert.venue}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Tickets and details: ${eventCanonicalUrl(concert)}`,
    location: `${concert.venue}, Stockholm`,
    ctz: "Europe/Stockholm",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
