
-- Step 1: Create immutable date_only function
CREATE OR REPLACE FUNCTION public.date_only(ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$ SELECT ts::date; $$;
