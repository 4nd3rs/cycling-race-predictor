import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, races, raceResults, riders } from "../src/lib/db";
import { eq, ilike } from "drizzle-orm";

async function checkDuplicates() {
  // Find Pablo
  const pablo = await db.query.riders.findFirst({
    where: ilike(riders.name, "%Pablo%Rodríguez%"),
  });

  if (!pablo) {
    console.log("Pablo not found");
    return;
  }

  console.log("Found rider:", pablo.name, pablo.id);

  // Get all his results
  const results = await db
    .select({
      result: raceResults,
      race: races,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .where(eq(raceResults.riderId, pablo.id));

  console.log(`\nFound ${results.length} results:\n`);

  for (const { result, race } of results) {
    console.log(`Race: ${race.name}`);
    console.log(`  Category: ${race.ageCategory} ${race.gender}`);
    console.log(`  Date: ${race.date}`);
    console.log(`  Position: ${result.position}`);
    console.log(`  Race ID: ${race.id}`);
    console.log(`  Result ID: ${result.id}`);
    console.log("");
  }

  // Check for duplicate races
  console.log("\n=== All Junior races ===");
  const juniorRaces = await db
    .select()
    .from(races)
    .where(eq(races.ageCategory, "junior"));

  for (const race of juniorRaces) {
    console.log(`${race.name} | ${race.gender} | ${race.date} | ID: ${race.id}`);
  }
}

checkDuplicates().catch(console.error);
