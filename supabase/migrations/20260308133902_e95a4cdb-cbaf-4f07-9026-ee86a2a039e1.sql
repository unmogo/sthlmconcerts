
-- Delete non-Stockholm venues
DELETE FROM concerts WHERE venue IN (
  'Malmö Arena', 'O2', 'O2 Arena', 'Outdoor Venue', 'Scandinavium', 
  'Sundsvall', 'The Pavilion', 'The Roundhouse', 'Venue B', 'Musikhalle',
  'Starlight', 'Jazz Cafe'
);

-- Normalize remaining
UPDATE concerts SET venue = 'Strawberry Arena' WHERE venue = 'Tele2 Arena';
UPDATE concerts SET venue = 'Kulturhuset Stadsteatern' WHERE venue = 'Kulturhuset';
UPDATE concerts SET venue = 'Stockholm Waterfront' WHERE venue = 'Waterfront';
