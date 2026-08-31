alter table public.scrape_jobs add column if not exists heartbeat_at timestamptz;

update public.scrape_jobs
set status = 'failed',
    error = coalesce(error, 'Marked failed by watchdog: runtime stopped before completing.'),
    finished_at = coalesce(finished_at, now())
where status in ('running','queued')
  and coalesce(heartbeat_at, started_at, created_at) < now() - interval '12 minutes';

-- Upgrade stored low-res CDN crops to their large variants.
update public.concerts
set image_url = regexp_replace(image_url, '_(EVENT_DETAIL_PAGE|RETINA_PORTRAIT|TABLET_LANDSCAPE|ARTIST_PAGE|RECOMENDATION)(_16_9|_3_2)?\.(jpg|jpeg|png|webp)', '_TABLET_LANDSCAPE_LARGE_16_9.\3')
where image_url ~ '_(EVENT_DETAIL_PAGE|RETINA_PORTRAIT|TABLET_LANDSCAPE|ARTIST_PAGE|RECOMENDATION)(_16_9|_3_2)?\.(jpg|jpeg|png|webp)';

update public.concerts
set image_url = regexp_replace(image_url, '(livespot\.se/img/[0-9a-f]{8,}/)[0-9]+(\.(webp|jpg|jpeg|png))', '\g<1>800\2')
where image_url ~ 'livespot\.se/img/[0-9a-f]{8,}/[0-9]+\.(webp|jpg|jpeg|png)';

update public.concerts
set image_url = replace(image_url, 'width=1080', 'width=1920')
where image_url like '%dynamicmedia.livenationinternational.com%width=1080%';