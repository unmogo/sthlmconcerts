
-- Add event_type column 
ALTER TABLE public.concerts ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'concert';

-- Delete obvious duplicates: keep the one with the shortest artist name (cleanest) per venue+date group
DELETE FROM public.concerts a
USING public.concerts b
WHERE a.id > b.id
  AND a.date = b.date
  AND (
    -- Same venue (fuzzy: one contains the other)
    lower(a.venue) LIKE '%' || lower(split_part(b.venue, ',', 1)) || '%'
    OR lower(b.venue) LIKE '%' || lower(split_part(a.venue, ',', 1)) || '%'
  )
  AND (
    -- Same artist (fuzzy: one contains the other)
    lower(a.artist) LIKE '%' || lower(b.artist) || '%'
    OR lower(b.artist) LIKE '%' || lower(a.artist) || '%'
  );
