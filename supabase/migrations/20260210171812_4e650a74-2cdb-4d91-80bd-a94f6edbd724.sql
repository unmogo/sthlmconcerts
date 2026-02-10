
-- Create concerts table
CREATE TABLE public.concerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  artist TEXT NOT NULL,
  venue TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  ticket_url TEXT,
  ticket_sale_date TIMESTAMPTZ,
  tickets_available BOOLEAN DEFAULT false,
  image_url TEXT,
  source TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(artist, venue, date)
);

-- Enable RLS
ALTER TABLE public.concerts ENABLE ROW LEVEL SECURITY;

-- Public read access (this is a public-facing concert listing)
CREATE POLICY "Anyone can view concerts"
ON public.concerts
FOR SELECT
USING (true);

-- Only service role can insert/update/delete (via edge functions)
CREATE POLICY "Service role can manage concerts"
ON public.concerts
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_concerts_updated_at
BEFORE UPDATE ON public.concerts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
