
-- Enable pg_net extension for server-side HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create a function to trigger the next scrape batch via pg_net
CREATE OR REPLACE FUNCTION public.trigger_scrape_batch(batch_num int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text;
  anon_key text;
BEGIN
  -- Get config from vault or hardcode project URL
  supabase_url := current_setting('app.settings.supabase_url', true);
  
  PERFORM net.http_post(
    url := 'https://bdbvyayxzlyxjzeiyfwh.supabase.co/functions/v1/scrape-concerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkYnZ5YXl4emx5eGp6ZWl5ZndoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDI1NTMsImV4cCI6MjA4NjMxODU1M30.t-YZy9KfEanYCfnGcTMD8MxG0386ztOrt7lqfTSoLLw'
    ),
    body := jsonb_build_object('batch', batch_num, 'chain', true)
  );
END;
$$;
