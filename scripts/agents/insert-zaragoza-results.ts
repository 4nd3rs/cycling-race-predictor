/**
 * Insert Gran Premio Zaragoza XCO 2026 results
 * Source: https://cyclingflash.com/event/gran-premio-zaragoza-xco-2026
 *
 * Elite Men:   1. Tobias Lillelund (DEN), 2. Thibaut François (FRA), 3. Christopher Dawson
 * Elite Women: 1. Anne Terpstra (NED), 2. Estibaliz Sagardoy Zunzarren (ESP), 3. Janika Lõiv (EST)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents, raceResults, riders } from "./lib/db";
import { eq, ilike, or } from "drizzle-orm";

async function findRider(nameParts: string[]): Promise<{ id: string; name: string } | null> {
  for (const part of nameParts) {
    if (part.length < 4) continue;
    const rows = await db.select({ id: riders.id, name: riders.name })
      .from(riders)
      .where(ilike(riders.name, `%${part}%`))
      .limit(5);
    // Find best match
    const match = rows.find(r =>
      nameParts.some(p => p.length > 3 && r.name.toLowerCase().includes(p.toLowerCase()))
    );
    if (match) return match;
  }
  return null;
}

async function insertResult(raceId: string, riderId: string, position: number) {
  await db.insert(raceResults).values({
    id: crypto.randomUUID(),
    raceId,
    riderId,
    position,
  }).onConflictDoNothing();
}

async function main() {
  console.log("\n📋 Inserting Gran Premio Zaragoza XCO 2026 results\n");

  // Find races
  const zaragozaRaces = await db.select({
    id: races.id, gender: races.gender, date: races.date, name: raceEvents.name,
  })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(ilike(raceEvents.name, "%zaragoza%"));

  if (zaragozaRaces.length === 0) {
    console.log("No Zaragoza races found.");
    return;
  }

  for (const r of zaragozaRaces) {
    console.log(`Found: ${r.name} (${r.gender}) ${r.date} — ${r.id}`);
  }

  const menRace = zaragozaRaces.find(r => r.gender === "men");
  const womenRace = zaragozaRaces.find(r => r.gender === "women");

  // ── Men's results ──
  const menResults = [
    { parts: ["Lillelund", "Tobias"], position: 1 },
    { parts: ["Francois", "François", "Thibaut"], position: 2 },
    { parts: ["Dawson", "Christopher"], position: 3 },
  ];

  if (menRace) {
    const existing = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, menRace.id));
    if (existing.length > 0) {
      console.log(`\n[Men] Already has ${existing.length} results — skipping`);
    } else {
      console.log(`\n[Men] Inserting results for ${menRace.id}`);
      for (const r of menResults) {
        const rider = await findRider(r.parts);
        if (rider) {
          await insertResult(menRace.id, rider.id, r.position);
          console.log(`  P${r.position}: ${rider.name} ✅`);
        } else {
          console.log(`  P${r.position}: ${r.parts[0]} — not found in DB`);
        }
      }
      await db.update(races).set({ status: "completed" }).where(eq(races.id, menRace.id));
      console.log("  Race marked completed ✅");
    }
  }

  // ── Women's results ──
  const womenResults = [
    { parts: ["Terpstra", "Anne"], position: 1 },
    { parts: ["Sagardoy", "Estibaliz"], position: 2 },
    { parts: ["Loiv", "Lõiv", "Janika"], position: 3 },
  ];

  if (womenRace) {
    const existing = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, womenRace.id));
    if (existing.length > 0) {
      console.log(`\n[Women] Already has ${existing.length} results — skipping`);
    } else {
      console.log(`\n[Women] Inserting results for ${womenRace.id}`);
      for (const r of womenResults) {
        const rider = await findRider(r.parts);
        if (rider) {
          await insertResult(womenRace.id, rider.id, r.position);
          console.log(`  P${r.position}: ${rider.name} ✅`);
        } else {
          console.log(`  P${r.position}: ${r.parts[0]} — not found in DB`);
        }
      }
      await db.update(races).set({ status: "completed" }).where(eq(races.id, womenRace.id));
      console.log("  Race marked completed ✅");
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
