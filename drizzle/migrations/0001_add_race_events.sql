-- Migration: Add race_events table for multi-category MTB events
-- This allows linking multiple races (Elite Men, Elite Women, U23, Junior, etc.)
-- to a single event (e.g., Shimano Supercup La Nucía 2026)

-- Create the race_events table
CREATE TABLE IF NOT EXISTS "race_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "date" date NOT NULL,
  "discipline" varchar(20) NOT NULL,
  "country" char(3),
  "source_url" varchar(500),
  "source_type" varchar(50),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Add indexes
CREATE INDEX IF NOT EXISTS "idx_race_events_date" ON "race_events" ("date");
CREATE INDEX IF NOT EXISTS "idx_race_events_discipline" ON "race_events" ("discipline");

-- Add race_event_id column to races table (nullable for backwards compatibility)
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "race_event_id" uuid REFERENCES "race_events"("id");

-- Add index for the new foreign key
CREATE INDEX IF NOT EXISTS "idx_races_race_event" ON "races" ("race_event_id");
