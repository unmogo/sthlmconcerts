
-- Clean up venue-placeholder images (shared by 3+ different artists)
WITH shared_images AS (
  SELECT image_url FROM concerts 
  WHERE date >= now() AND image_url IS NOT NULL AND image_url != ''
  GROUP BY image_url HAVING count(DISTINCT artist) >= 3
)
UPDATE concerts SET image_url = NULL
WHERE image_url IN (SELECT image_url FROM shared_images);
