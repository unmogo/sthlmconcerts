
UPDATE concerts
SET image_url = NULL
WHERE image_url IN (
  SELECT image_url
  FROM concerts
  WHERE date >= now() AND image_url IS NOT NULL
  GROUP BY image_url
  HAVING COUNT(DISTINCT artist) >= 3
);
