/**
 * Fix the Strade Bianche 2026 data mess:
 * 1. Remove stale 2025 men's race from the 2026 event
 * 2. Move 2026 men's race from "Donne" event to correct event
 * 3. Consolidate women's race (keep the one with startlist data)
 */
import { db, races, raceEvents, raceStartlist, raceResults, predictions } from "./lib/db";
import { eq, and, ilike } from "drizzle-orm";

const CORRECT_EVENT_ID = "4834428d-85ac-49ab-b4ba-eae34717222e"; // "Strade Bianche" event (2026)
const DONNE_EVENT_ID = "7356b123-e438-4db4-a1d9-d546420b05d3";  // "Strade Bianche Donne" event (2026)

async function main() {
  // 1. Find the stale 2025 men's race in the correct event
  const staleRaces = await db.select({ id: races.id, name: races.name, date: races.date, gender: races.gender })
    .from(races)
    .where(and(eq(races.raceEventId, CORRECT_EVENT_ID), eq(races.gender, "men")));

  for (const r of staleRaces) {
    if (r.date && r.date.startsWith("2025")) {
      console.log(`Archiving stale 2025 race: ${r.name} (${r.id})`);
      // Set status to completed and detach from 2026 event (or just mark inactive)
      await db.update(races).set({ status: "completed" }).where(eq(races.id, r.id));
      // Don't delete — keep historical data but it won't show as active
    }
  }

  // 2. Move 2026 men's race from Donne event to correct event
  const donneRaces = await db.select({ id: races.id, name: races.name, gender: races.gender, date: races.date })
    .from(races)
    .where(eq(races.raceEventId, DONNE_EVENT_ID));

  for (const r of donneRaces) {
    if (r.gender === "men") {
      console.log(`Moving men's race to correct event: ${r.name} (${r.id})`);
      await db.update(races).set({
        raceEventId: CORRECT_EVENT_ID,
        name: "Strade Bianche - Elite Men",
        categorySlug: "elite-men",
        pcsUrl: "https://www.procyclingstats.com/race/strade-bianche/2026",
      }).where(eq(races.id, r.id));
    }
  }

  // 3. Consolidate women's race - the one under Donne has 71 riders, the one under correct event has 0
  const correctWomen = await db.select({ id: races.id, name: races.name })
    .from(races)
    .where(and(eq(races.raceEventId, CORRECT_EVENT_ID), eq(races.gender, "women")));

  const donneWomen = await db.select({ id: races.id, name: races.name })
    .from(races)
    .where(and(eq(races.raceEventId, DONNE_EVENT_ID), eq(races.gender, "women")));

  if (correctWomen.length > 0 && donneWomen.length > 0) {
    // Check startlist counts
    for (const w of correctWomen) {
      const sl = await db.select({ id: raceStartlist.id }).from(raceStartlist).where(eq(raceStartlist.raceId, w.id));
      console.log(`  Correct event women (${w.name}): ${sl.length} startlist entries`);
    }
    for (const w of donneWomen) {
      const sl = await db.select({ id: raceStartlist.id }).from(raceStartlist).where(eq(raceStartlist.raceId, w.id));
      console.log(`  Donne event women (${w.name}): ${sl.length} startlist entries`);
    }

    // Move the Donne women's race startlist to the correct event's women's race
    // The correct event already has a women's race with pcsUrl strade-bianche-we
    // The donne event has a women's race with startlist data but wrong pcsUrl
    // Best approach: delete the empty correct women's race, move the donne one
    if (correctWomen.length > 0 && donneWomen.length > 0) {
      const emptyWomen = correctWomen[0];
      const fullWomen = donneWomen[0];

      // Delete the empty women's race
      await db.delete(raceStartlist).where(eq(raceStartlist.raceId, emptyWomen.id));
      await db.delete(predictions).where(eq(predictions.raceId, emptyWomen.id));
      await db.delete(raceResults).where(eq(raceResults.raceId, emptyWomen.id));
      await db.delete(races).where(eq(races.id, emptyWomen.id));
      console.log(`Deleted empty women's race: ${emptyWomen.name} (${emptyWomen.id})`);

      // Move the full women's race to correct event
      await db.update(races).set({
        raceEventId: CORRECT_EVENT_ID,
        name: "Strade Bianche - Elite Women",
        categorySlug: "elite-women",
        pcsUrl: "https://www.procyclingstats.com/race/strade-bianche-we/2026",
      }).where(eq(races.id, fullWomen.id));
      console.log(`Moved women's race to correct event: ${fullWomen.name} → Strade Bianche - Elite Women`);
    }
  }

  // 4. Verify final state
  console.log("\n=== Final state ===");
  const finalRaces = await db.select({ id: races.id, name: races.name, date: races.date, gender: races.gender, status: races.status, pcsUrl: races.pcsUrl })
    .from(races)
    .where(eq(races.raceEventId, CORRECT_EVENT_ID));
  for (const r of finalRaces) {
    const sl = await db.select({ id: raceStartlist.id }).from(raceStartlist).where(eq(raceStartlist.raceId, r.id));
    const res = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, r.id));
    console.log(`${r.name} | ${r.gender} | ${r.date} | ${r.status} | startlist: ${sl.length} | results: ${res.length} | ${r.pcsUrl || "NO PCS"}`);
  }

  // Check if Donne event is now empty
  const remaining = await db.select({ id: races.id }).from(races).where(eq(races.raceEventId, DONNE_EVENT_ID));
  console.log(`\nDonne event has ${remaining.length} races remaining`);
}

main().catch(console.error);
