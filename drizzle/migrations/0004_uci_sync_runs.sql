-- UCI Sync Runs table: tracks each sync execution
CREATE TABLE IF NOT EXISTS "uci_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "discipline" varchar(20) NOT NULL,
  "source" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "total_entries" integer DEFAULT 0,
  "riders_created" integer DEFAULT 0,
  "riders_updated" integer DEFAULT 0,
  "teams_created" integer DEFAULT 0,
  "errors" jsonb DEFAULT '[]'::jsonb,
  "category_details" jsonb DEFAULT '[]'::jsonb
);

-- Partial unique indexes on riders to prevent duplicate external IDs
-- Drizzle ORM doesn't support WHERE clauses on unique indexes, so we create them manually
CREATE UNIQUE INDEX IF NOT EXISTS "riders_xco_id_unique" ON "riders" ("xco_id") WHERE "xco_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "riders_uci_id_unique" ON "riders" ("uci_id") WHERE "uci_id" IS NOT NULL;

-- Fix existing 2-letter nationality codes to 3-letter UCI codes
UPDATE "riders" SET "nationality" = 'ESP' WHERE "nationality" = 'ES';
UPDATE "riders" SET "nationality" = 'FRA' WHERE "nationality" = 'FR';
UPDATE "riders" SET "nationality" = 'GER' WHERE "nationality" = 'DE';
UPDATE "riders" SET "nationality" = 'ITA' WHERE "nationality" = 'IT';
UPDATE "riders" SET "nationality" = 'BEL' WHERE "nationality" = 'BE';
UPDATE "riders" SET "nationality" = 'NED' WHERE "nationality" = 'NL';
UPDATE "riders" SET "nationality" = 'GBR' WHERE "nationality" = 'GB';
UPDATE "riders" SET "nationality" = 'POR' WHERE "nationality" = 'PT';
UPDATE "riders" SET "nationality" = 'SUI' WHERE "nationality" = 'CH';
UPDATE "riders" SET "nationality" = 'AUT' WHERE "nationality" = 'AT';
UPDATE "riders" SET "nationality" = 'POL' WHERE "nationality" = 'PL';
UPDATE "riders" SET "nationality" = 'CZE' WHERE "nationality" = 'CZ';
UPDATE "riders" SET "nationality" = 'DEN' WHERE "nationality" = 'DK';
UPDATE "riders" SET "nationality" = 'SWE' WHERE "nationality" = 'SE';
UPDATE "riders" SET "nationality" = 'NOR' WHERE "nationality" = 'NO';
UPDATE "riders" SET "nationality" = 'USA' WHERE "nationality" = 'US';
UPDATE "riders" SET "nationality" = 'CAN' WHERE "nationality" = 'CA';
UPDATE "riders" SET "nationality" = 'AUS' WHERE "nationality" = 'AU';
UPDATE "riders" SET "nationality" = 'BRA' WHERE "nationality" = 'BR';
UPDATE "riders" SET "nationality" = 'ARG' WHERE "nationality" = 'AR';
UPDATE "riders" SET "nationality" = 'COL' WHERE "nationality" = 'CO';
UPDATE "riders" SET "nationality" = 'RSA' WHERE "nationality" = 'ZA';
UPDATE "riders" SET "nationality" = 'JPN' WHERE "nationality" = 'JP';
UPDATE "riders" SET "nationality" = 'SLO' WHERE "nationality" = 'SI';
UPDATE "riders" SET "nationality" = 'CRO' WHERE "nationality" = 'HR';
UPDATE "riders" SET "nationality" = 'ROU' WHERE "nationality" = 'RO';
UPDATE "riders" SET "nationality" = 'HUN' WHERE "nationality" = 'HU';
UPDATE "riders" SET "nationality" = 'SVK' WHERE "nationality" = 'SK';
UPDATE "riders" SET "nationality" = 'IRL' WHERE "nationality" = 'IE';
UPDATE "riders" SET "nationality" = 'FIN' WHERE "nationality" = 'FI';
UPDATE "riders" SET "nationality" = 'NZL' WHERE "nationality" = 'NZ';
UPDATE "riders" SET "nationality" = 'CHI' WHERE "nationality" = 'CL';
UPDATE "riders" SET "nationality" = 'AND' WHERE "nationality" = 'AD';
