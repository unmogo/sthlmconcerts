
-- Remove near-duplicate concerts where shorter artist name is substring of longer one, same venue and date
WITH dupes AS (
  SELECT b.id as remove_id
  FROM concerts a
  JOIN concerts b ON a.venue = b.venue 
    AND date_only(a.date::timestamptz) = date_only(b.date::timestamptz) 
    AND a.id != b.id 
    AND length(a.artist) > length(b.artist)
    AND a.artist ilike '%' || b.artist || '%'
  WHERE a.date >= now() AND b.date >= now()
)
DELETE FROM concerts WHERE id IN (SELECT remove_id FROM dupes);
