/**
 * Migration: Add timing system columns to race_events
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE race_events ADD COLUMN IF NOT EXISTS timing_system VARCHAR(50)`;
  await sql`ALTER TABLE race_events ADD COLUMN IF NOT EXISTS timing_event_id VARCHAR(100)`;
  await sql`ALTER TABLE race_events ADD COLUMN IF NOT EXISTS timing_event_url VARCHAR(500)`;
  console.log("✅ Migration done — timing columns added to race_events");
}

main().catch(console.error);
