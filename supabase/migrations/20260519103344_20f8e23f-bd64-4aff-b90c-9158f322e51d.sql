-- Delete the malformed Billy Opel duplicate (venue parsed from URL slug)
DELETE FROM public.concerts
WHERE id = '55d3663a-38d6-4285-a652-90c860135ce6';

-- Remove any other (source_url, date) duplicates, keep the oldest row
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY source_url, date ORDER BY created_at) AS rn
  FROM public.concerts
  WHERE source_url IS NOT NULL
)
DELETE FROM public.concerts c
USING ranked r
WHERE c.id = r.id AND r.rn > 1;

-- Prevent future duplicates at the database level
CREATE UNIQUE INDEX IF NOT EXISTS concerts_source_url_date_unique
  ON public.concerts (source_url, date)
  WHERE source_url IS NOT NULL;