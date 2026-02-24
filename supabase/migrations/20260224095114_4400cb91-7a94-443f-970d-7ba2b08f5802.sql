
-- Track deleted concerts so they don't get re-added by the scraper
CREATE TABLE public.deleted_concerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  artist text NOT NULL,
  venue text NOT NULL,
  date timestamp with time zone NOT NULL,
  deleted_by uuid,
  deleted_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create a unique constraint on artist+venue+date to avoid duplicate entries
CREATE UNIQUE INDEX idx_deleted_concerts_unique ON public.deleted_concerts (artist, venue, date);

ALTER TABLE public.deleted_concerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage deleted concerts"
ON public.deleted_concerts FOR ALL
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);

CREATE POLICY "Admins can view deleted concerts"
ON public.deleted_concerts FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));
