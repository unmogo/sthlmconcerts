# Architecture

## Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   React UI  │────▶│  Edge Functions   │────▶│  Database   │
│  (Vite/TS)  │◀────│  (Deno runtime)   │◀────│ (Postgres)  │
└─────────────┘     └──────────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  External   │
                    │  APIs       │
                    │  - Firecrawl│
                    │  - Evently  │
                    │  - MusicBrainz
                    │  - Wikipedia│
                    └─────────────┘
```

## Database Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `concerts` | Main event data | Public read, admin write |
| `favorites` | User-saved concerts | User-scoped |
| `deleted_concerts` | Scraper exclusion list | Admin write, service read |
| `scrape_log` | Scraper run history | Service write |
| `user_roles` | Admin role assignments | Service-managed |

## Auth Flow
- Email/password sign-up with email verification
- Admin role checked via `user_roles` table + `has_role()` DB function
- Auth context provides `user`, `isAdmin`, `signOut`

## Scraping Pipeline (Evently-first)

### Batch 1: Primary Source (Evently)
1. Scrape `evently.se/en/place/se/stockholm?categories=music&page=60` (all music)
2. Scrape `evently.se/en/place/se/stockholm?categories=standup&page=60` (all comedy)
3. For each event, match against existing DB (artist+date) to resolve venue
4. Events with known venues → upsert immediately
5. Events needing venues → stored in enrichment queue

### Batch 2-5: Venue Enrichment
- Scrape evently detail pages for events without venues
- Extract address → map to known Stockholm venue via ADDRESS_TO_VENUE lookup
- Reject any event where venue = "Stockholm, Sweden"

### Batch 6-10: Gap-Fill (Secondary Sources)
- Cirkus, Södra Teatern, Gröna Lund, Stockholm Live, AXS, Konserthuset
- Ticketmaster, Live Nation (top pages only — not 50-page deep crawl)
- Comedy: Nöjesteatern, Hyvens
- RA Stockholm, All Things Live
- Only scrape for events NOT already in DB

### Incremental Mode (Weekly)
- Only batch 1 checks for new/changed events on evently
- Secondary sources only gap-fill what's missing
- Status changes (cancellations, tickets on sale) detected via re-scrape

## Image Pipeline
1. Admin clicks "Images" → invokes `fetch-images`
2. Finds concerts with `image_url IS NULL`
3. For each: MusicBrainz → Wikidata → Wikipedia Commons → iTunes fallback
4. Updates `image_url` on match
