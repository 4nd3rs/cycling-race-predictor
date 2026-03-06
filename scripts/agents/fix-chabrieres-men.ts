import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceResults, riders } from "./lib/db";
import { eq, ilike, or } from "drizzle-orm";

async function main() {
  const RACE_ID = "9efd616c-e22e-4a69-bda6-ea16e546a79a";

  // Check what's currently in there
  const current = await db.select({ id: raceResults.id, pos: raceResults.position, riderId: raceResults.riderId })
    .from(raceResults).where(eq(raceResults.raceId, RACE_ID));
  console.log("Current results:", JSON.stringify(current));

  // Check who is the wrong P1
  for (const r of current) {
    const rider = await db.select({ name: riders.name }).from(riders).where(eq(riders.id, r.riderId));
    console.log(`  P${r.pos}: ${rider[0]?.name} (result id: ${r.id})`);
  }

  // Look for Dario Lillo (Swiss XCO rider)
  const liloSearch = await db.select({ id: riders.id, name: riders.name, nationality: riders.nationality })
    .from(riders)
    .where(or(ilike(riders.name, "%Lillo%"), ilike(riders.name, "%Dario%")))
    .limit(10);
  console.log("\nDario Lillo search:", JSON.stringify(liloSearch));

  // Delete wrong P1 and insert correct one if found
  const wrongP1 = current.find(r => r.pos === 1);
  if (wrongP1) {
    await db.delete(raceResults).where(eq(raceResults.id, wrongP1.id));
    console.log("\nDeleted wrong P1 result");
  }

  // Dario Lillo — if not in DB, note it
  const darioLillo = liloSearch.find(r => r.name.toLowerCase().includes("lillo") && !r.name.toLowerCase().includes("paolillo"));
  if (darioLillo) {
    await db.insert(raceResults).values({
      id: crypto.randomUUID(),
      raceId: RACE_ID,
      riderId: darioLillo.id,
      position: 1,
    });
    console.log(`Inserted correct P1: ${darioLillo.name} ✅`);
  } else {
    console.log("Dario Lillo not found in DB — inserting as unknown, race stays completed but no P1 rider linked");
    // Leave P1 empty — at least P2 Schuermans is correct
  }
}

main().catch(console.error);
