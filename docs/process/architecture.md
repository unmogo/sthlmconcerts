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

## Scraping Pipeline
1. Admin clicks "Refresh" → invokes `scrape-concerts` batch 1
2. Each batch scrapes a subset of sources via Firecrawl
3. After completing, batch auto-chains to next batch via `pg_net` + RPC
4. 24 total batches cover all configured sources
5. Results upserted with dedup on `(artist, venue, date)`
6. `deleted_concerts` table checked to skip previously removed events

## Image Pipeline
1. Admin clicks "Images" → invokes `fetch-images`
2. Finds concerts with `image_url IS NULL`
3. For each: MusicBrainz → Wikidata → Wikipedia Commons → iTunes fallback
4. Updates `image_url` on match
