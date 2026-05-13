-- Clear images from hosts known to return wrong/unrelated thumbnails so the
-- image fetcher can repopulate them with proper artist/poster images.
UPDATE public.concerts
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND (
    image_url ILIKE '%ytimg.com%' OR
    image_url ILIKE '%guim.co.uk%' OR
    image_url ILIKE '%static01.nyt.com%' OR
    image_url ILIKE '%media.cnn.com%' OR
    image_url ILIKE '%nypost.com/wp-content%' OR
    image_url ILIKE '%thesun.co.uk%' OR
    image_url ILIKE '%dailymail.co.uk%' OR
    image_url ILIKE '%bbci.co.uk%' OR
    image_url ILIKE '%wikipedia.org/wiki%' OR
    image_url ILIKE '%lookaside.fbsbx.com%' OR
    image_url ILIKE '%cdninstagram%' OR
    image_url ILIKE '%scontent%' OR
    image_url ILIKE '%storyblok.com/f/336862%' -- nalen venue facade reused as artist
  );