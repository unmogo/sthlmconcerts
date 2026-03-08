# Questions for Human

> When the agent is blocked or needs a decision, questions go here.  
> Human: check this file regularly, answer inline, then the agent continues.

---

## Open Questions

### Q4: Evently scraping approach (2026-03-08)
**Asked:** 2026-03-08  
Evently uses infinite scroll — Firecrawl only captures ~10 events per scrape regardless of scroll actions or page parameter.

**Options**:
1. Use **Firecrawl map** to discover all `/en/events/` URLs on evently.se, then batch-scrape detail pages directly
2. Check if evently has a **hidden JSON API** (many SPAs expose `/api/events?city=stockholm`)
3. Scrape pages 1-10 separately (each ~10 new events = ~100 total)
4. Use **Firecrawl search** `site:evently.se stockholm music` to find event URLs

**Recommendation**: Option 1 (Firecrawl map) — one cheap call to discover all event URLs, then batch detail pages.

**Answer:** <!-- answer here -->

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
