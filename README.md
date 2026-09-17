# STHLM Concerts

Every upcoming concert and comedy show in Stockholm in one searchable list, with venue, date and a direct ticket link, for people deciding what to see. Built with React, Vite, TypeScript and Tailwind CSS on a Supabase backend, managed in Lovable.

**Status:** working. Live at <https://sthlmevents.lovable.app/>.

## Quickstart

Bun is the package manager this repo is installed with (`bun.lock`). `npm ci` does not work today: `package-lock.json` is out of sync with `package.json`.

```bash
git clone https://github.com/unmogo/sthlmconcerts.git
cd sthlmconcerts
bun install --frozen-lockfile
bun run dev        # http://localhost:8080
```

Other scripts:

```bash
bun run build      # production build into dist/
bun run preview    # serve dist/ locally
bun run lint       # eslint (currently reports 7 errors, see CLAUDE.md)
```

`dev` and `build` first run `scripts/generate-sitemap.ts` (`predev` / `prebuild`), which needs network access to the live Supabase project and rewrites `public/sitemap.xml`.

## Usage

Screens (routes in `src/App.tsx`):

| Route | Page | What it does |
|---|---|---|
| `/` | `src/pages/Index.tsx` | All upcoming events from today on, with search, concert/comedy filter tabs and favourites |
| `/event/:slug` | `src/pages/EventDetail.tsx` | One event: image, venue, date, ticket link, share and add-to-calendar, Event JSON-LD for search engines |
| `/auth` | `src/pages/Auth.tsx` | Sign in / sign up (email and password, magic link, Google/Apple via Lovable Cloud) |
| `/reset-password` | `src/pages/ResetPassword.tsx` | Password reset |

Example: every event page lives at `/event/<artist>-<venue>-<yyyy-mm-dd>-<first 6 chars of id>`; the slug is assigned by a database trigger (`assign_concert_slug`), and `public/sitemap.xml` lists them all.

Signed-in users can save favourites. Admins (a row in `user_roles`) also get header controls to add, edit, delete and export events, run the scraper, fetch images, resolve ticket links, and follow job progress in the Logs dashboard. The UI is in English and Swedish (`src/i18n/`).

## Project layout

```
src/pages/               route components
src/components/          app components; ui/ is shadcn/ui, header/ holds admin controls
src/lib/api/concerts.ts  every call to the database and edge functions
src/integrations/        Supabase client and generated DB types, Lovable auth (generated, do not edit)
src/i18n/                en.json, sv.json
supabase/functions/      Deno edge functions: scrapers, image and ticket enrichment, admin CRUD
supabase/functions/_shared/  source list, Firecrawl and AI clients, venue resolution, HTML extraction
supabase/migrations/     database schema, RLS policies, DB functions
scripts/                 generate-sitemap.ts (runs before dev and build)
public/                  static files, including the generated sitemap.xml, robots.txt, llms.txt
docs/process/            earlier agent process notes and architecture (partly out of date)
```

## Data

Events live in the Supabase Postgres database, not in the repo. They get there through edge functions an admin starts from the UI:

```
admin clicks Scrape
   |
   v
scrape-concerts ---- one source per invocation, then calls itself for the next
   |                 RA -> Evently music -> Evently stand-up -> LiveSpot -> Cirkus -> Eventim music -> Eventim comedy
   |                 (pages fetched via Firecrawl or plain HTTP; Lovable AI gateway extracts events and resolves venues)
   |                 drops non-Stockholm events and anything in deleted_concerts
   v
concerts table  <--- manage-concerts (admin add / edit / delete / scrape a single URL)
   |            <--- fetch-images (poster from source, Spotify, MusicBrainz, Wikipedia, og:image)
   |            <--- resolve-tickets (replaces aggregator links with the real ticket seller)
   v
browser reads concerts directly with the publishable key (public read via RLS)
```

- Job progress is written to `scrape_jobs`, per-source results to `scrape_log`.
- Deleting an event records it in `deleted_concerts` so the scraper does not bring it back.
- `image-proxy` serves evently.se images, which block hotlinking.
- `cleanup-evently-urls` is an admin-only maintenance function for ticket links; nothing in the UI calls it.
- There is no schedule: the scraper runs when an admin starts it.

Tracked: schema (`supabase/migrations/`), the generated `public/sitemap.xml`. Not tracked: event data, `node_modules/`, `dist/`. To refresh the sitemap, run `bun run build`.

## Configuration

The browser app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (`src/integrations/supabase/client.ts`); `.env` also carries `VITE_SUPABASE_PROJECT_ID`. All three are documented in `.env.example`.

This is a Lovable-managed repo, so the tracked `.env` already holds them. They are browser-public by design. Put local overrides in `.env.local` (ignored).

Edge functions read their secrets from Supabase function secrets, never from the repo: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase), `FIRECRAWL_API_KEY`, `LOVABLE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`. Function settings (JWT verification off, 900 s wall clock for long jobs) are in `supabase/config.toml`.

## Deploy

Lovable hosts the site at <https://sthlmevents.lovable.app/> and publishes it from the Lovable editor; Lovable commits its edits to `main` here (the `Changes` commits). The Supabase project (id in `supabase/config.toml`) is Lovable Cloud, which applies edge functions and migrations. There is no deploy pipeline in this repo; CI only installs and builds.

## Conventions

Agent and contributor rules are in [CLAUDE.md](CLAUDE.md). Conventional commits, a branch per change, squash-merged PRs. Lovable's own `Changes` auto-commits are the tolerated exception.
