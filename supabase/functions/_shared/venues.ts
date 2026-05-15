// Venue normalisation: small curated map + AI fallback.
// Trigger normalize_concert_before_upsert handles aliases — this is for
// resolving free-text "Stockholm, Sweden" / addresses to a real venue.
import { AiClient } from "./ai.ts";

export const KNOWN_VENUES = [
  "Avicii Arena", "Strawberry Arena", "Stockholm Live", "Cirkus", "Chinateatern",
  "Konserthuset", "Kulturhuset Stadsteatern", "Stockholm Waterfront",
  "Debaser Strand", "Debaser Hornstulls Strand", "Debaser Medis", "Debaser Slussen",
  "Debaser", "Nalen", "Münchenbryggeriet", "Fryshuset", "Klubben", "Arenan",
  "Berns", "Berns Salonger", "Södra Teatern", "Kägelbanan", "Slaktkyrkan",
  "Gröna Lund", "Stora Scen", "Cirkus Cirkör", "Hyvens", "Nöjesteatern",
  "Bar Brooklyn", "Pustervik", "Annexet", "Hovet", "Globen", "Fasching",
  "Tyrol", "Trädgården", "Under Bron", "Pet Sounds Bar", "Hus 7",
];

const ADDRESS_HINTS: Record<string, string> = {
  "hornstulls strand": "Debaser Strand",
  "medborgarplatsen": "Debaser Medis",
  "katarinavägen": "Slaktkyrkan",
  "torkel knutssonsgatan": "Münchenbryggeriet",
  "regeringsgatan 74": "Nalen",
  "berzelii park": "Berns",
  "mosebacke torg": "Södra Teatern",
  "klarabergsviadukten": "Stockholm Waterfront",
  "sveavägen 51": "Berns",
  "berwaldhallen": "Berwaldhallen",
  "kungsträdgården": "Stockholm Live",
};

const INVALID_VENUES = new Set([
  "stockholm", "stockholm, sweden", "sweden", "sverige",
  "n/a", "tba", "unknown", "unknown venue", "",
]);

export function isValidVenue(v: string | undefined | null): v is string {
  if (!v) return false;
  return !INVALID_VENUES.has(v.toLowerCase().trim());
}

export function quickResolveVenue(venue_raw?: string, address_raw?: string): string | null {
  const v = venue_raw?.trim();
  if (v && !INVALID_VENUES.has(v.toLowerCase()) && v.length > 1) {
    // Match against known venue list (case-insensitive contains)
    const lc = v.toLowerCase();
    for (const k of KNOWN_VENUES) if (lc.includes(k.toLowerCase())) return k;
    // Looks like a real venue name we just don't recognise — keep it.
    if (!/^stockholm/i.test(v) && v.length >= 3) return v;
  }
  const a = address_raw?.toLowerCase() ?? "";
  for (const [needle, venue] of Object.entries(ADDRESS_HINTS)) {
    if (a.includes(needle)) return venue;
  }
  return null;
}

export async function aiResolveVenue(
  ai: AiClient,
  venue_raw: string | undefined,
  address_raw: string | undefined,
): Promise<string | null> {
  if (!venue_raw && !address_raw) return null;
  try {
    const out = await ai.json<{ venue: string; confidence: number }>({
      system:
        "You map raw Stockholm event venue text to the canonical venue name. " +
        "Only return a name from the provided list, or 'UNKNOWN'. Never return 'Stockholm'.",
      user: `Known venues: ${KNOWN_VENUES.join(", ")}\n\nRaw venue: ${venue_raw ?? ""}\nAddress: ${address_raw ?? ""}`,
      schema: {
        type: "object",
        properties: {
          venue: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["venue", "confidence"],
        additionalProperties: false,
      },
    });
    if (out.venue && out.venue !== "UNKNOWN" && out.confidence >= 0.6 && isValidVenue(out.venue)) {
      return out.venue;
    }
  } catch (_e) { /* swallow */ }
  return null;
}
