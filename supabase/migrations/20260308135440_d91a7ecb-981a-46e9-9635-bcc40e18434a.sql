
-- Fix search path on date_only
CREATE OR REPLACE FUNCTION public.date_only(ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$ SELECT ts::date; $$;

-- Delete John 5 wrong venues
DELETE FROM concerts WHERE lower(artist) = 'john 5' AND public.date_only(date) = '2026-05-31' AND venue != 'Nalen';

-- Deduplicate: keep one per (artist, venue, day)
DELETE FROM concerts WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY lower(trim(artist)), lower(trim(venue)), public.date_only(date)
      ORDER BY created_at ASC
    ) as rn
    FROM concerts
  ) ranked WHERE rn > 1
);

-- Also dedup same artist on same day with DIFFERENT wrong venues (keep first created)
DELETE FROM concerts WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY lower(trim(split_part(artist, ':', 1))), public.date_only(date)
      ORDER BY created_at ASC
    ) as rn
    FROM concerts
  ) ranked WHERE rn > 1
);

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_concerts_dedup 
ON concerts (lower(trim(artist)), lower(trim(venue)), public.date_only(date));

-- Create normalization trigger
CREATE OR REPLACE FUNCTION public.normalize_concert_before_upsert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.artist := trim(NEW.artist);
  
  CASE lower(trim(NEW.venue))
    WHEN 'friends arena' THEN NEW.venue := 'Strawberry Arena';
    WHEN 'tele2 arena' THEN NEW.venue := 'Strawberry Arena';
    WHEN 'stora scen' THEN NEW.venue := 'Gröna Lund';
    WHEN 'stora scenen' THEN NEW.venue := 'Gröna Lund';
    WHEN 'lilla scenen' THEN NEW.venue := 'Gröna Lund';
    WHEN 'nya cirkus' THEN NEW.venue := 'Cirkus';
    WHEN 'china teatern' THEN NEW.venue := 'Chinateatern';
    WHEN 'konserthuset - stockholm' THEN NEW.venue := 'Konserthuset';
    WHEN 'konserthuset stockholm' THEN NEW.venue := 'Konserthuset';
    WHEN 'ericsson globe' THEN NEW.venue := 'Avicii Arena';
    WHEN 'globen' THEN NEW.venue := 'Avicii Arena';
    WHEN 'kulturhuset' THEN NEW.venue := 'Kulturhuset Stadsteatern';
    WHEN 'waterfront' THEN NEW.venue := 'Stockholm Waterfront';
    ELSE NULL;
  END CASE;

  IF lower(trim(NEW.venue)) IN ('stockholm', 'stockholm, sweden', 'sweden', 'sverige', '', 'n/a', 'tba', 'unknown', 'unknown venue') THEN
    RAISE EXCEPTION 'Invalid venue: %', NEW.venue;
  END IF;
  
  IF NEW.ticket_url IS NOT NULL AND (
    NEW.ticket_url ILIKE '%example.com%' OR NEW.ticket_url ILIKE '%test.com%' OR
    NEW.ticket_url ILIKE '%lovable.app%' OR NEW.ticket_url ILIKE '%localhost%'
  ) THEN
    NEW.ticket_url := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_normalize_concert
BEFORE INSERT OR UPDATE ON concerts
FOR EACH ROW
EXECUTE FUNCTION public.normalize_concert_before_upsert();
