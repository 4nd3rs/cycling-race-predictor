import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, races, raceResults, riders } from "../src/lib/db";
import { eq, and, ilike } from "drizzle-orm";

async function cleanup() {
  // 1. Delete Pablo's results from Junior Women races
  const pablo = await db.query.riders.findFirst({
    where: ilike(riders.name, "%Pablo%Rodríguez%"),
  });

  if (pablo) {
    // Get all Junior Women races
    const womenRaces = await db
      .select()
      .from(races)
      .where(and(eq(races.ageCategory, "junior"), eq(races.gender, "women")));

    for (const race of womenRaces) {
      const deleted = await db
        .delete(raceResults)
        .where(and(eq(raceResults.raceId, race.id), eq(raceResults.riderId, pablo.id)))
        .returning();

      if (deleted.length > 0) {
        console.log(`Deleted Pablo's result from: ${race.name}`);
      }
    }
  }

  // 2. Find and delete duplicate Junior Women race (keep the one with more results)
  const juniorWomenRaces = await db
    .select()
    .from(races)
    .where(and(eq(races.ageCategory, "junior"), eq(races.gender, "women"), ilike(races.name, "%Sant Fruitós%")));

  console.log(`\nFound ${juniorWomenRaces.length} Junior Women Sant Fruitós races`);

  if (juniorWomenRaces.length > 1) {
    // Count results for each
    for (const race of juniorWomenRaces) {
      const results = await db
        .select()
        .from(raceResults)
        .where(eq(raceResults.raceId, race.id));
      console.log(`  ${race.id}: ${results.length} results`);
    }

    // Delete the one with fewer results (or the second one if equal)
    const raceCounts = await Promise.all(
      juniorWomenRaces.map(async (race) => {
        const results = await db
          .select()
          .from(raceResults)
          .where(eq(raceResults.raceId, race.id));
        return { race, count: results.length };
      })
    );

    raceCounts.sort((a, b) => b.count - a.count);
    const toDelete = raceCounts.slice(1); // Keep the one with most results

    for (const { race } of toDelete) {
      // Delete results first
      await db.delete(raceResults).where(eq(raceResults.raceId, race.id));
      // Delete race
      await db.delete(races).where(eq(races.id, race.id));
      console.log(`Deleted duplicate race: ${race.name} (${race.id})`);
    }
  }

  // 3. Check for duplicate Junior Men races
  const juniorMenRaces = await db
    .select()
    .from(races)
    .where(and(eq(races.ageCategory, "junior"), eq(races.gender, "men"), ilike(races.name, "%Sant Fruitós%")));

  console.log(`\nFound ${juniorMenRaces.length} Junior Men Sant Fruitós races:`);
  for (const race of juniorMenRaces) {
    const results = await db
      .select()
      .from(raceResults)
      .where(eq(raceResults.raceId, race.id));
    console.log(`  ${race.date}: ${results.length} results (${race.id})`);
  }

  console.log("\nCleanup complete!");
}

cleanup().catch(console.error);
