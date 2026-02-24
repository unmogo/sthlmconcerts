# Changelog

## 2026-02-24
- ✅ Created `deleted_concerts` table for tracking manually removed events
- ✅ Updated scraper to skip previously deleted concerts
- ✅ Added data quality filters (dummy URL blacklist, Stockholm geo-filter)
- ✅ Switched image sourcing from iTunes to MusicBrainz/Wikipedia
- ✅ Added `tickets_available` toggle to Add/Edit concert dialogs
- ✅ Fixed `.catch()` bug in manage-concerts edge function (upsert returns `{data, error}`, not a Promise)
- ✅ Created process documentation (`docs/process/`)
