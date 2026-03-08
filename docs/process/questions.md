# Questions for Human

> When the agent is blocked or needs a decision, questions go here.  
> Human: check this file regularly, answer inline, then the agent continues.

---

## Open Questions

### Q5: Code Review — Tool & Architecture Improvements (2026-03-08)
**Asked:** 2026-03-08  
After a full review of the codebase, here are recommended improvements. Code improvements have been implemented. Tool/architecture improvements need your decision:

**Recommended Tool Improvements:**

1. **Scheduled scraping via pg_cron** — Instead of manual "Refresh" clicks, set up a weekly cron job (Monday 02:00 UTC) that triggers batch 1 with chaining. Currently the `trigger_scrape_batch` RPC exists but no cron schedule is active.
   - Cost: Low | Impact: High — fully autonomous data freshness
   
2. **Firecrawl credit monitoring** — Add a pre-scrape check of remaining Firecrawl credits and abort gracefully if below threshold, instead of hitting 402 errors mid-pipeline.
   - Cost: Low | Impact: Medium

3. **Scrape diff dashboard** — After each scrape, show admin a summary: "12 new events, 3 updated, 2 venues resolved". Currently logged to `scrape_log` but not visible in UI.
   - Cost: Medium | Impact: High — admin visibility

4. **Event deduplication at DB level** — Add a PostgreSQL trigger that normalizes artist/venue before insert, preventing duplicates at the source rather than relying on client-side dedup.
   - Cost: Medium | Impact: High — cleaner data

5. **Spotify image integration** — You have a Spotify client ID in the docs. Using Spotify's API for artist images would give much better results than MusicBrainz→Wikipedia→iTunes chain.
   - Cost: Medium | Impact: High — better images

6. **Push notifications for favorites** — When a new event is added for an artist a user has favorited, send an email notification via a database trigger + edge function.
   - Cost: High | Impact: Medium

7. **Calendar export (ICS)** — Let users export events to Google Calendar / Apple Calendar. Simple ICS file generation from concert data.
   - Cost: Low | Impact: Medium

**Which of these should I implement?** (answer with numbers, e.g., "1, 3, 5")

**Answer:** <!-- answer here -->

### Q4: Evently scraping approach (2026-03-08)
**Asked:** 2026-03-08  
**Status:** Implemented — Using Firecrawl map to discover all `/en/events/` URLs, then batch-scraping detail pages. This uses 1 credit for the map + 1 credit per detail page (only new events).

---

## Answered Questions

### Q1: Venue normalization — complete list?
**Answer:** Added Kägelbanan, Södra Teatern, and 30+ address-to-venue mappings.

### Q2: Image fallback priority
**Answer:** Spotify first (client ID: 5296dddd172f45cfa517b27cead76f8e). Then MusicBrainz → Wikipedia → iTunes.

### Q3: Scrape frequency
**Answer:** Once a week. Implemented via pg_cron Monday 02:00 UTC.

---

## Format
```
### Q[N]: Short title
**Asked:** YYYY-MM-DD  
Context and question here.

**Answer:** <!-- answer here -->
```
