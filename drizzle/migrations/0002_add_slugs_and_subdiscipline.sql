-- Add slug and sub_discipline to race_events table
ALTER TABLE race_events ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
ALTER TABLE race_events ADD COLUMN IF NOT EXISTS sub_discipline VARCHAR(20);

-- Add category_slug to races table
ALTER TABLE races ADD COLUMN IF NOT EXISTS category_slug VARCHAR(50);

-- Create unique index on (discipline, slug) for race_events
-- Only create if it doesn't exist (handle case where slug is null initially)
CREATE UNIQUE INDEX IF NOT EXISTS race_events_discipline_slug_unique ON race_events(discipline, slug) WHERE slug IS NOT NULL;

-- Create index on category_slug for races
CREATE INDEX IF NOT EXISTS idx_races_category_slug ON races(category_slug);

-- Consolidate discipline values: mtb_xco -> mtb (store xco in sub_discipline)
-- For race_events table
UPDATE race_events SET sub_discipline = 'xco', discipline = 'mtb' WHERE discipline = 'mtb_xco';
UPDATE race_events SET sub_discipline = 'xcc', discipline = 'mtb' WHERE discipline = 'mtb_xcc';
UPDATE race_events SET sub_discipline = 'xce', discipline = 'mtb' WHERE discipline = 'mtb_xce';
UPDATE race_events SET sub_discipline = 'xcm', discipline = 'mtb' WHERE discipline = 'mtb_xcm';

-- For races table
UPDATE races SET discipline = 'mtb' WHERE discipline = 'mtb_xco';
UPDATE races SET discipline = 'mtb' WHERE discipline = 'mtb_xcc';
UPDATE races SET discipline = 'mtb' WHERE discipline = 'mtb_xce';
UPDATE races SET discipline = 'mtb' WHERE discipline = 'mtb_xcm';

-- For rider_discipline_stats table (keep the old format for now, but add new discipline values)
-- We'll handle this separately in the migration script since it's more complex
