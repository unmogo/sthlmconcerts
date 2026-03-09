import type { Concert } from "@/types/concert";

// Venue alias normalization for consistent grouping
const VENUE_ALIASES: Record<string, string> = {
  "friends arena": "Strawberry Arena",
  "strawberry arena": "Strawberry Arena",
  "ericsson globe": "Avicii Arena",
  "avicii arena": "Avicii Arena",
  "globen": "Avicii Arena",
  "hovet": "Hovet",
  "annexet": "Annexet",
  "guldgruvan": "Guldgruvan comedyklubb",
  "guldgruvan comedyklubb": "Guldgruvan comedyklubb",
};

/**
 * Recurring comedy shows that should be grouped by artist name only
 * (regardless of minor venue differences)
 */
const RECURRING_COMEDY_PATTERNS = [
  "guldgruvan",
  "raw sthlm",
  "raw comedy",
  "revolver comedy",
  "maffia comedy",
  "comedy superweekend",
  "full english standup",
  "svensk humor",
  "hipphipp",
];

/**
 * Check if a concert represents a recurring comedy series
 */
const isRecurringComedySeries = (artist: string): boolean => {
  const lower = artist.toLowerCase();
  return RECURRING_COMEDY_PATTERNS.some((pattern) => lower.includes(pattern));
};

/**
 * Heuristic: "series" titles should group even if venue strings vary
 * (e.g. weekly standup clubs, open mics, comedy nights).
 */
const COMEDY_SERIES_KEYWORDS = [
  "comedy",
  "standup",
  "stand-up",
  "open mic",
  "klubb",
  "club",
  "komedi",
  "humor",
  "humour",
  "improv",
  "roast",
];

const isLikelyComedySeriesTitle = (artist: string): boolean => {
  const lower = artist.toLowerCase();
  return COMEDY_SERIES_KEYWORDS.some((kw) => lower.includes(kw));
};

/**
 * Normalize venue name using known aliases
 */
export const normalizeVenueName = (venue: string): string => {
  const lower = venue.toLowerCase().trim();
  return VENUE_ALIASES[lower] || venue;
};

/**
 * Strip tour names/subtitles for grouping purposes
 */
export const normalizeForGroup = (artistName: string): string =>
  artistName
    .replace(/\s*[\(\[].*?[\)\]]/g, "") // remove (feat. X), [Live], etc.
    .replace(/\s+[wW]\/\s+.*/g, "") // remove "w/ Guest"
    .replace(/\s*\+\s+förband.*/gi, "") // remove "+ förband"
    .split(/[:\-–—|]/)[0]
    .trim()
    .toLowerCase();

/**
 * Generate grouping key for a concert
 * For comedy series, we only use the title to group all dates together.
 */
const getGroupingKey = (concert: Concert): string => {
  const normalizedArtist = normalizeForGroup(concert.artist);

  const shouldGroupComedyByTitleOnly =
    concert.event_type === "comedy" &&
    (isRecurringComedySeries(concert.artist) || isLikelyComedySeriesTitle(concert.artist));

  if (shouldGroupComedyByTitleOnly) {
    let key = normalizedArtist;
    if (key.includes("maffia comedy")) key = "maffia comedy superweekend";
    if (key.includes("raw sthlm") || key.includes("raw comedy")) key = "raw sthlm";
    return `recurring:${key}`;
  }

  // Default grouping: artist + venue
  return `${normalizedArtist}|${normalizeVenueName(concert.venue).toLowerCase().trim()}`;
};

/**
 * Deduplicate concerts: same grouping key + same calendar date → keep one
 * Prefers earliest time and shortest artist name
 */
export const deduplicateConcerts = (concerts: Concert[]): Concert[] => {
  const seen = new Map<string, Concert>();
  
  for (const concert of concerts) {
    // Use date-only key so multiple times on same day collapse to one
    const dateKey = new Date(concert.date).toISOString().split("T")[0];
    const groupKey = getGroupingKey(concert);
    const key = `${groupKey}|${dateKey}`;
    
    const existing = seen.get(key);
    if (!existing || concert.artist.length < existing.artist.length) {
      seen.set(key, concert);
    }
  }
  
  return [...seen.values()];
};

/**
 * Group concerts by same artist + venue (different dates only)
 * Recurring comedy series are grouped by artist name only
 */
export const groupConcerts = (concerts: Concert[]): { primary: Concert; extras: Concert[] }[] => {
  const deduped = deduplicateConcerts(concerts);
  const groups: Map<string, Concert[]> = new Map();

  for (const concert of deduped) {
    const key = getGroupingKey(concert);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(concert);
  }

  const result: { primary: Concert; extras: Concert[] }[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    result.push({ primary: group[0], extras: group.slice(1) });
  }

  // Sort by earliest date
  result.sort((a, b) => new Date(a.primary.date).getTime() - new Date(b.primary.date).getTime());
  
  return result;
};

/**
 * Filter concerts by search query (artist or venue)
 */
export const filterBySearch = (concerts: Concert[], query: string): Concert[] => {
  if (!query.trim()) return concerts;
  
  const q = query.toLowerCase();
  return concerts.filter(
    (concert) =>
      concert.artist.toLowerCase().includes(q) ||
      normalizeVenueName(concert.venue).toLowerCase().includes(q)
  );
};