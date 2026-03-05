import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents } from "./lib/db";
import { eq, and, or, ilike } from "drizzle-orm";

async function main() {
  // Find phantom women's races for Paris-Nice and Tirreno-Adriatico
  const phantomRaces = await db
    .select({ id: races.id, gender: races.gender, date: races.date, name: raceEvents.name, slug: raceEvents.slug, eventId: raceEvents.id })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(
      and(
        eq(races.gender, "women"),
        or(
          ilike(raceEvents.name, "%paris-nice%"),
          ilike(raceEvents.name, "%tirreno%")
        )
      )
    );

  if (phantomRaces.length === 0) {
    console.log("No phantom races found.");
    return;
  }

  console.log("Found phantom races to delete:");
  for (const r of phantomRaces) {
    console.log(`  ${r.id} | ${r.name} (${r.gender}) | ${r.date} | event=${r.eventId}`);
  }

  // Delete the race rows
  for (const r of phantomRaces) {
    await db.delete(races).where(eq(races.id, r.id));
    console.log(`  Deleted race ${r.id} (${r.name} Women)`);

    // If the race_event now has no races left, delete it too
    const remaining = await db.select({ id: races.id }).from(races).where(eq(races.raceEventId, r.eventId));
    if (remaining.length === 0) {
      await db.delete(raceEvents).where(eq(raceEvents.id, r.eventId));
      console.log(`  Deleted orphan race_event ${r.eventId} (${r.name})`);
    }
  }

  console.log("Done.");
}

main().catch(console.error);
