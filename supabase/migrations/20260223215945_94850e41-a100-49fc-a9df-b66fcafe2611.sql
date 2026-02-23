
-- scrape_log table for observability
CREATE TABLE public.scrape_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch int,
  source text,
  events_found int DEFAULT 0,
  events_upserted int DEFAULT 0,
  error text,
  duration_ms int,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.scrape_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scrape logs"
ON public.scrape_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage scrape logs"
ON public.scrape_log FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Cleanup: delete concerts older than 7 days
CREATE OR REPLACE FUNCTION public.cleanup_old_concerts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.concerts WHERE date < now() - interval '7 days';
$$;
