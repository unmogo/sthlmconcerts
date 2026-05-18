
-- 1. Add slug column
ALTER TABLE public.concerts ADD COLUMN IF NOT EXISTS slug text;

-- 2. Slug generator function
CREATE OR REPLACE FUNCTION public.generate_concert_slug(_artist text, _venue text, _date timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  base text;
BEGIN
  base := lower(coalesce(_artist,'') || '-' || coalesce(_venue,'') || '-' || to_char(_date,'YYYY-MM-DD'));
  -- transliterate common swedish chars
  base := translate(base, 'åäöéèüáàâêîôûñç', 'aaoeeuaaaeiouunc');
  -- strip everything that isn't a-z 0-9 or dash
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := regexp_replace(base, '(^-+|-+$)', '', 'g');
  base := regexp_replace(base, '-{2,}', '-', 'g');
  IF base = '' THEN base := 'event'; END IF;
  RETURN left(base, 120);
END;
$$;

-- 3. Trigger: assign slug on insert/update if missing; append short id suffix to guarantee uniqueness
CREATE OR REPLACE FUNCTION public.assign_concert_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base text;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := public.generate_concert_slug(NEW.artist, NEW.venue, NEW.date);
    NEW.slug := base || '-' || substr(NEW.id::text, 1, 6);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_concert_slug ON public.concerts;
CREATE TRIGGER trg_assign_concert_slug
BEFORE INSERT OR UPDATE ON public.concerts
FOR EACH ROW EXECUTE FUNCTION public.assign_concert_slug();

-- 4. Backfill
UPDATE public.concerts
SET slug = public.generate_concert_slug(artist, venue, date) || '-' || substr(id::text, 1, 6)
WHERE slug IS NULL OR slug = '';

-- 5. Unique index
CREATE UNIQUE INDEX IF NOT EXISTS concerts_slug_unique ON public.concerts(slug);
