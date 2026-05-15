CREATE TABLE public.scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  triggered_by uuid,
  current_step text,
  progress integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  events_found integer NOT NULL DEFAULT 0,
  events_upserted integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scrape_jobs_created ON public.scrape_jobs (created_at DESC);
CREATE INDEX idx_scrape_jobs_status ON public.scrape_jobs (status);

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scrape jobs"
  ON public.scrape_jobs
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages scrape jobs"
  ON public.scrape_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');