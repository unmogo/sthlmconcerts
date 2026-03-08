
-- Delete all fake events with example.com ticket URLs
DELETE FROM concerts WHERE ticket_url ILIKE '%example.com%';

-- Delete events with invalid/non-Stockholm venues  
DELETE FROM concerts WHERE venue IN (
  'Unknown Venue', 'TBA', 'Unknown', 'N/A', '??', 'Arena', 'Stadium', 
  'Concert Hall', 'Venue A', 'Venue C', 'Annex', 'Royal Arena', 'Olympia', 
  'Techno Club', 'Warehouse', 'The Garden', 'Globe Arena', 'Festival Grounds', 
  'Stockholm Arena', 'Hall', 'Comedy Stop', 'Venue to be announced', 
  'Live Nation', '3Arena', 'unknown'
);

-- Normalize venue names
UPDATE concerts SET venue = 'Strawberry Arena' WHERE venue = 'Friends Arena';
UPDATE concerts SET venue = 'Gröna Lund' WHERE venue IN ('Stora Scen', 'Stora Scenen', 'Lilla Scenen');
UPDATE concerts SET venue = 'Konserthuset' WHERE venue = 'Konserthuset - Stockholm';
UPDATE concerts SET venue = 'Chinateatern' WHERE venue = 'China Teatern';
UPDATE concerts SET venue = 'Cirkus' WHERE venue = 'Nya Cirkus';
