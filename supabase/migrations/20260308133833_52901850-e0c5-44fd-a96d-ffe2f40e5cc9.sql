
-- Delete conflicting duplicates before normalization
DELETE FROM concerts WHERE id IN (
  -- Stora Scen dupes (keep Gröna Lund)
  '5d6e510b-a843-4593-a09e-ee919de67ac0', 'fbc8e613-28be-46b5-bd52-0b64e1424aee',
  'a3e483e3-9c12-498d-bb60-50fa7f472a35', 'ccd7693c-d364-4277-ac96-832de3d17217',
  '8c69bacd-434f-40f4-b14c-49cf67b4f149', 'd2426321-d8f8-4780-94ac-3352fb04bdc4',
  '7b6e1014-890b-440f-b346-3174c3435cb5', 'fab5e754-7a3d-45bc-90bd-542abe8b127a',
  '9c3c9a04-a2e9-4850-950b-e26d586a0ddb', '5ff3b76b-ae2f-4dc2-adc9-b8c3c99508f3',
  '6b7017dc-a510-4a52-9931-bb12057431c7', '6f2b0242-072e-43dc-b53d-41b52e1e99f9',
  -- Nya Cirkus dupe (keep Cirkus)
  '37fd2c3b-0ef5-4a7e-80e3-29f3e914961e',
  -- Friends Arena dupes where Stadium/Concert Hall version will be deleted anyway
  '9673c11c-a6a3-4117-a508-44cd3bafe595',
  'fccae2c5-5af0-4ab4-8549-8f076c1f1d95'
)
