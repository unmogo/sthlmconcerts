## Step back: what's actually wrong today

Reading the current pipeline (`scrape-concerts` 2,040 lines, `fetch-images` 665 lines, `resolve-tickets`, `cleanup-evently-urls`):

- **Synchronous chaining over a single 150 s edge invocation.** Batches 1–10 each do a Firecrawl scrape + DB writes. When any one batch slows down, the whole chain dies with `IDLE_TIMEOUT`. The client `runMaintenanceJob` loop in `src/lib/api/concerts.ts` does up to 500 invocations sequentially — if the user closes the tab, it stops.
- **No durable job state.** `scrape_log` records each batch but there is no single "run" row to poll, so the UI cannot tell "still running" from "crashed".
- **Brittle HTML parsing.** Hundreds of regexes per source, plus `ADDRESS_TO_VENUE` lookups that miss anything new. This is why Jimmy Carr (eventim.se) is missing and venues collapse to "Stockholm, Sweden".
- **Image lookup goes wide too early.** Web search for ambiguous names ("GRAVE") returns TV thumbnails. Disambiguation is a cheap LLM call, currently absent.
- **No livespot.se / eventim.se coverage.**

## What we'll build

### 1. Job-runner pattern (`scrape_jobs` table)

New table `scrape_jobs(id, kind, status, progress, totals, started_at, finished_at, error, triggered_by)`. Every admin-triggered run creates one row. Edge functions return `202 + jobId` immediately and do all real work in `EdgeRuntime.waitUntil(...)`. UI polls the row.

RLS: admins can read; service role writes.

### 2. New `scrape-concerts` (rewrite)

```text
admin click "Refresh"
  → POST /scrape-concerts { mode: "full" | "incremental" }
  → insert scrape_jobs row, return { jobId } (202)
  → waitUntil(runScrapeJob(jobId))

runScrapeJob:
  for each source in [evently-music, evently-standup, livespot-konsert,
                      livespot-humor, eventim-stockholm]:
     1. Firecrawl scrape listing page(s)
     2. Lovable AI structured output → array<EventDraft>
        { artist, venue_raw, address_raw, date_iso, ticket_url,
          image_url, event_type, source_url }
     3. resolveVenue(venue_raw, address_raw) → uses ADDRESS_TO_VENUE
        first, falls back to AI venue resolver (one call per N events)
     4. upsert into concerts (skip if in deleted_concerts)
     5. update scrape_jobs.progress
  finalize status
```

Why this is faster and more reliable:
- One AI call per page replaces dozens of regexes. Page count, not regex count, drives runtime.
- `waitUntil` lets the job run up to the function's `wall_clock_timeout` (already 900 s) without holding the HTTP connection open.
- A single durable `scrape_jobs` row means the user can close the tab and come back.

### 3. New `fetch-images` (rewrite)

Pipeline becomes:
1. Trust evently `/api/file/` posters (already fixed).
2. For records still missing images, ask Lovable AI to **disambiguate the artist name**: returns `{ canonical_name, is_ambiguous, hint }`. Skip web search when ambiguous and no hint resolves it.
3. Try in order: Spotify → MusicBrainz → Wikipedia → og:image of `source_url`. Drop iTunes/web-search fallback — that's where TV thumbnails came from.
4. Same job-runner pattern: 202 + jobId + polling.

### 4. New sources

- **livespot.se**: `?city=stockholm&category=konsert` and `&category=humor`. Listing page → AI extraction → upsert.
- **eventim.se**: Stockholm city listing. Same extraction. Will pick up Jimmy Carr.

### 5. UI changes (admin only, minimal)

- `Header` Refresh / Images buttons now call the new endpoint, get `jobId`, and `ScrapeLogDashboard` shows the live `scrape_jobs` row (progress %, current source, errors). No separate page.
- `triggerResolveTickets` keeps current cursor pattern (it's fast).
- `runMaintenanceJob` loop in `src/lib/api/concerts.ts` is replaced by a `pollJob(jobId)` helper.

### 6. Backlog cleanup (one-shot, after rewrite ships)

- Run `cleanup-evently-urls` over remaining `%evently.se%` ticket URLs.
- Run new `fetch-images` job to backfill the records whose `image_url` was nulled.

## Model choice

Lovable AI Gateway does not expose Anthropic Sonnet. Closest equivalents for "newest reasoning model":
- **Default for parsing**: `google/gemini-3-flash-preview` — fast, cheap, JSON-mode, plenty good for HTML → struct.
- **Hard cases (venue resolution, ambiguous artists)**: `openai/gpt-5-mini`.

Both are wired through the existing `LOVABLE_API_KEY` (already set). No new secrets.

## Files

New:
- `supabase/migrations/<ts>_scrape_jobs.sql`
- `supabase/functions/_shared/ai.ts` (Lovable AI helper, structured output)
- `supabase/functions/_shared/sources/evently.ts`
- `supabase/functions/_shared/sources/livespot.ts`
- `supabase/functions/_shared/sources/eventim.ts`

Rewritten:
- `supabase/functions/scrape-concerts/index.ts` (down from 2,040 → ~400 lines)
- `supabase/functions/fetch-images/index.ts` (down from 665 → ~250 lines)

Edited:
- `src/lib/api/concerts.ts` — new `triggerScrape`/`triggerFetchImages` returning `{ jobId }`, `pollScrapeJob` helper.
- `src/components/Header.tsx` + `ScrapeLogDashboard.tsx` — show live job row.
- `supabase/config.toml` — keep `wall_clock_timeout = 900` on both.

Removed (folded into new structure): old per-batch dispatcher, `ADDRESS_TO_VENUE` mega-table replaced by smaller curated map + AI fallback.

## Risks / open items

- Each scrape run will use a few hundred AI requests. Acceptable for an admin-only weekly action; will surface in the job row as `tokens_used` so cost stays visible.
- livespot.se and eventim.se are JS-rendered; need Firecrawl `waitFor`. Verified in spec; handled.
- `EdgeRuntime.waitUntil` is supported on Supabase edge runtime — confirmed in current docs.

After approval, I'll ship the migration first, then the shared helpers, then each function and the UI wiring, then run the backlog one-shots.
