-- 1. Clear image URLs corrupted by a bad rewrite so they can be re-resolved.
UPDATE public.concerts SET image_url = NULL
WHERE image_url LIKE '%\g<%' OR image_url !~ '^https?://[a-z0-9.-]+\.[a-z]{2,}';

-- 2. Any event with a working outbound link is bookable, not TBA.
UPDATE public.concerts SET tickets_available = true
WHERE tickets_available = false
  AND (ticket_url IS NOT NULL OR source_url IS NOT NULL)
  AND (ticket_sale_date IS NULL OR ticket_sale_date <= now());

-- 3. Remove events that belong to other cities.
DELETE FROM public.concerts
WHERE (source_url ILIKE '%goteborg%' OR source_url ILIKE '%göteborg%' OR source_url ILIKE '%malmo%'
       OR source_url ILIKE '%malmö%' OR source_url ILIKE '%uppsala%' OR venue IN ('Pustervik','Nöjesteatern'))
  AND source_url NOT ILIKE '%stockholm%';