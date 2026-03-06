/**
 * Check damage from accidental deletion of 2026 Paris-Nice and Tirreno-Adriatico race rows,
 * and restore them if needed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents, raceStartlist, predictions } from "./lib/db";
import { eq, ilike, sql } from "drizzle-orm";

async function main() {
  // Check if orphaned startlist entries remain (no matching race row)
  const orphanedStartlists = await db.execute(
    sql`SELECT race_id, COUNT(*) as cnt FROM race_startlist 
        WHERE race_id NOT IN (SELECT id FROM races) 
        GROUP BY race_id`
  );
  console.log("Orphaned startlist entries by race_id:", JSON.stringify(orphanedStartlists.rows));

  const orphanedPredictions = await db.execute(
    sql`SELECT race_id, COUNT(*) as cnt FROM predictions 
        WHERE race_id NOT IN (SELECT id FROM races) 
        GROUP BY race_id`
  );
  console.log("Orphaned predictions by race_id:", JSON.stringify(orphanedPredictions.rows));

  // Check what race_events still exist for Paris-Nice and Tirreno 2026
  const events = await db.select({ id: raceEvents.id, name: raceEvents.name, date: raceEvents.date, slug: raceEvents.slug })
    .from(raceEvents)
    .where(ilike(raceEvents.name, "%paris-nice%"));
  console.log("\nParis-Nice events:", JSON.stringify(events));

  const tirrenoEvents = await db.select({ id: raceEvents.id, name: raceEvents.name, date: raceEvents.date })
    .from(raceEvents)
    .where(ilike(raceEvents.name, "%tirreno%"));
  console.log("Tirreno events:", JSON.stringify(tirrenoEvents));

  // Check current races for these events
  for (const ev of [...events, ...tirrenoEvents]) {
    const eventRaces = await db.select({ id: races.id, gender: races.gender, date: races.date, pcsUrl: races.pcsUrl,
      startlist: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})` })
      .from(races).where(eq(races.raceEventId, ev.id));
    console.log(`\nEvent ${ev.name} (${ev.date}):`, JSON.stringify(eventRaces));
  }
}

main().catch(console.error);
