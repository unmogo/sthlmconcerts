# Process: Data Cleanup & Quality

## Auto-Clean Rules (applied during scrape)

### URL Blacklist
Reject any event with ticket URLs matching:
- `example.com`, `test.com`
- `lovable.app`, `lovableproject.com`  
- `localhost`, `127.0.0.1`
- Any URL shorter than 10 characters

### Geographic Filter
Only keep events containing Stockholm-relevant keywords:
- Venue or city contains: `stockholm`, `sthlm`, `solna`, `globen`, `avicii arena`, `hovet`, `annexet`, `cirkus`, `konserthuset`, `debaser`, `münchenbryggeriet`, `gröna lund`, `skansen`, `södra teatern`, `berns`, `nalen`, `fållan`, `vasateatern`, `dramaten`

### Venue Normalization
| Raw Name | Normalized |
|----------|-----------|
| Stora Scen (Gröna Lund) | Gröna Lund |
| Friends Arena | Strawberry Arena |
| Globen | Avicii Arena |
| Ericsson Globe | Avicii Arena |
<!-- Add more as discovered -->

### Deduplication
- Normalize: lowercase, strip "the ", trim whitespace
- Match on: `(normalized_artist, normalized_venue, date)`
- Residencies: max 2 date entries per artist+venue combo

## Flag Rules (requires admin review)
- Same artist at 3+ different venues within 7 days
- Event with no ticket URL after 14 days
- Venue not in known Stockholm venue list

## Deletion Tracking
- When admin deletes a concert, record `(artist, venue, date)` in `deleted_concerts`
- Scraper checks this table before upserting — skips matches
- Prevents "zombie" events from returning after manual cleanup
