# Changelog

## 2026-03-08
- ✅ DB-level deduplication: unique index on `(lower(artist), lower(venue), date_only(date))` + normalization trigger
- ✅ Spotify image integration: replaced MusicBrainz chain with Spotify API (19/20 hits on first run)
- ✅ Scrape diff dashboard: admin "Logs" button shows batch history with found/upserted counts
- ✅ Fixed John 5 duplicates (kept Nalen, removed fake Avicii Arena/Annexet entries)
- ✅ Cleaned all same-artist-same-day duplicates across wrong venues
- ✅ Full scraper run: 287 events, all with images
- ✅ Added Copenhagen Drummers @ Göta Lejon (Apr 14, 2027)

## 2026-02-24
- ✅ Created `deleted_concerts` table for tracking manually removed events
- ✅ Updated scraper to skip previously deleted concerts
- ✅ Added data quality filters (dummy URL blacklist, Stockholm geo-filter)
- ✅ Switched image sourcing from iTunes to MusicBrainz/Wikipedia
- ✅ Added `tickets_available` toggle to Add/Edit concert dialogs
- ✅ Fixed `.catch()` bug in manage-concerts edge function (upsert returns `{data, error}`, not a Promise)
- ✅ Created process documentation (`docs/process/`)
