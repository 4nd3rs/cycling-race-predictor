/**
 * Reset Database and Apply New Schema
 *
 * This script:
 * 1. Clears all race-related data (in dependency order)
 * 2. Applies the new schema with slugs and subDiscipline
 *
 * Run with: npx tsx scripts/reset-and-migrate.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { config } from "dotenv";

// Load .env.local for local development
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient);

async function resetAndMigrate() {
  console.log("🗑️  Clearing existing race data...\n");

  // Clear tables in dependency order (children first, then parents)
  const tablesToClear = [
    "elo_history",
    "predictions",
    "race_results",
    "race_startlist",
    "rider_rumours",
    "discussion_posts",
    "discussion_threads",
    "ai_chat_sessions",
    "user_tips",
    "races",
    "race_events",
  ];

  for (const table of tablesToClear) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE`));
      console.log(`  ✓ Cleared ${table}`);
    } catch (error) {
      // Table might not exist or be empty, that's ok
      console.log(`  - Skipped ${table} (may not exist)`);
    }
  }

  console.log("\n📦 Applying schema changes...\n");

  // Add new columns if they don't exist
  const schemaChanges = [
    // race_events: add slug column
    `ALTER TABLE race_events ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`,
    // race_events: add sub_discipline column
    `ALTER TABLE race_events ADD COLUMN IF NOT EXISTS sub_discipline VARCHAR(20)`,
    // races: add category_slug column
    `ALTER TABLE races ADD COLUMN IF NOT EXISTS category_slug VARCHAR(50)`,
  ];

  for (const change of schemaChanges) {
    try {
      await db.execute(sql.raw(change));
      console.log(`  ✓ ${change.substring(0, 60)}...`);
    } catch (error) {
      console.log(`  - Already applied: ${change.substring(0, 50)}...`);
    }
  }

  // Create indexes
  console.log("\n📊 Creating indexes...\n");

  const indexes = [
    // Unique index on discipline + slug for race_events
    `CREATE UNIQUE INDEX IF NOT EXISTS race_events_discipline_slug_unique
     ON race_events(discipline, slug) WHERE slug IS NOT NULL`,
    // Index on category_slug for races
    `CREATE INDEX IF NOT EXISTS idx_races_category_slug ON races(category_slug)`,
  ];

  for (const idx of indexes) {
    try {
      await db.execute(sql.raw(idx));
      console.log(`  ✓ Index created`);
    } catch (error) {
      console.log(`  - Index may already exist`);
    }
  }

  // Verify the schema
  console.log("\n🔍 Verifying schema...\n");

  try {
    // Check race_events columns
    const eventCols = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'race_events'
      AND column_name IN ('slug', 'sub_discipline')
    `));
    console.log(`  race_events new columns: ${eventCols.rows.map((r: any) => r.column_name).join(', ')}`);

    // Check races columns
    const raceCols = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'races'
      AND column_name = 'category_slug'
    `));
    console.log(`  races new columns: ${raceCols.rows.map((r: any) => r.column_name).join(', ')}`);

    // Count remaining data
    const eventCount = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM race_events`));
    const raceCount = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM races`));
    console.log(`\n  race_events: ${(eventCount.rows[0] as any).count} rows`);
    console.log(`  races: ${(raceCount.rows[0] as any).count} rows`);

  } catch (error) {
    console.error("Error verifying schema:", error);
  }

  console.log("\n✅ Reset and migration complete!");
  console.log("\nNew URL structure is ready:");
  console.log("  /races/mtb                              → MTB events list");
  console.log("  /races/mtb/event-slug                   → Event overview");
  console.log("  /races/mtb/event-slug/elite-men         → Category results");
  console.log("  /races/mtb/event-slug/elite-men/stage-1 → Stage results");
}

resetAndMigrate().catch(console.error);
