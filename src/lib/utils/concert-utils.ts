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
 * Deduplicate concerts: same normalized artist + venue + same calendar date → keep one
 * Prefers earliest time and shortest artist name
 */
export const deduplicateConcerts = (concerts: Concert[]): Concert[] => {
  const seen = new Map<string, Concert>();
  
  for (const concert of concerts) {
    // Use date-only key so multiple times on same day collapse to one
    const dateKey = new Date(concert.date).toISOString().split("T")[0];
    const key = `${normalizeForGroup(concert.artist)}|${normalizeVenueName(concert.venue).toLowerCase().trim()}|${dateKey}`;
    
    const existing = seen.get(key);
    if (!existing || concert.artist.length < existing.artist.length) {
      seen.set(key, concert);
    }
  }
  
  return [...seen.values()];
};

/**
 * Group concerts by same artist + venue (different dates only)
 */
export const groupConcerts = (concerts: Concert[]): { primary: Concert; extras: Concert[] }[] => {
  const deduped = deduplicateConcerts(concerts);
  const groups: Map<string, Concert[]> = new Map();

  for (const concert of deduped) {
    const key = `${normalizeForGroup(concert.artist)}|${normalizeVenueName(concert.venue).toLowerCase().trim()}`;
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