/**
 * Quick script to add team_id columns to tables
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Adding team_id columns...");

  try {
    // Add team_id column to race_results if it doesn't exist
    await sql`
      ALTER TABLE race_results
      ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id)
    `;
    console.log("✓ team_id column added to race_results");

    // Add team_id column to riders if it doesn't exist
    await sql`
      ALTER TABLE riders
      ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id)
    `;
    console.log("✓ team_id column added to riders");

    // Add unique constraint to race_events if it doesn't exist
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS race_events_discipline_slug_unique
      ON race_events(discipline, slug)
    `;
    console.log("✓ unique constraint added to race_events");

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }

  console.log("Done!");
}

main();
