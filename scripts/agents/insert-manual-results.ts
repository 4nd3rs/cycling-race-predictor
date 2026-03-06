/**
 * insert-manual-results.ts
 * Manually inserts race results sourced from the web when xcodata/PCS don't have them yet.
 * 
 * VTT Chabrières 2026 (Mar 1) — source: creuse-oxygene.com/actualites/ (Mar 3 post)
 *   Elite Men:   1. Lillo Dario (SUI), 2. Jens Schuermans (BEL)
 *   Elite Women: 1. Léna Gérault (FRA)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents, raceResults, riders } from "./lib/db";
import { eq, and, ilike, or } from "drizzle-orm";

async function findOrCreateRider(name: string, nationality: string): Promise<string | null> {
  // Try to find existing rider by name
  const [first, ...rest] = name.trim().split(" ");
  const existing = await db.select({ id: riders.id, name: riders.name })
    .from(riders)
    .where(ilike(riders.name, `%${name}%`))
    .limit(3);

  if (existing.length === 1) {
    console.log(`  Found rider: ${existing[0].name} (${existing[0].id})`);
    return existing[0].id;
  }
  if (existing.length > 1) {
    console.log(`  Multiple matches for ${name}: ${existing.map(r => r.name).join(", ")} — skipping`);
    return null;
  }

  // Create new rider
  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  await db.insert(riders).values({
    id,
    name: name.trim(),
    nationality,
    gender: "men", // overridden below if needed
  });
  console.log(`  Created rider: ${name} (${id})`);
  return id;
}

async function main() {
  console.log("\n📋 Manual Results Insert — VTT Chabrières 2026\n");

  // Find the races
  const chabrieresRaces = await db.select({
    id: races.id,
    gender: races.gender,
    date: races.date,
    name: raceEvents.name,
  })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(or(
      ilike(raceEvents.name, "%Chabrières%"),
      ilike(raceEvents.name, "%Chabrieres%")
    ));

  if (chabrieresRaces.length === 0) {
    console.log("No Chabrières races found in DB.");
    return;
  }

  for (const race of chabrieresRaces) {
    console.log(`Race: ${race.name} (${race.gender}) — ${race.date} — id=${race.id}`);
  }

  const menRace = chabrieresRaces.find(r => r.gender === "men");
  const womenRace = chabrieresRaces.find(r => r.gender === "women");

  // ── Elite Men results ─────────────────────────────────────────────────────
  // Source: creuse-oxygene.com — "victoire du Suisse Lillo Dario devant le Belge Jens Schuermans"
  if (menRace) {
    console.log(`\n[Men] Inserting results for race ${menRace.id}`);

    // Check if results already exist
    const existing = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, menRace.id));
    if (existing.length > 0) {
      console.log(`  Already has ${existing.length} results — skipping`);
    } else {
      const menResults = [
        { name: "Dario Lillo", nationality: "SUI", position: 1 },
        { name: "Jens Schuermans", nationality: "BEL", position: 2 },
      ];

      for (const r of menResults) {
        // Try name variants
        const found = await db.select({ id: riders.id, name: riders.name })
          .from(riders)
          .where(or(
            ilike(riders.name, `%${r.name}%`),
            ilike(riders.name, `%Lillo%`),
            ilike(riders.name, `%Schuermans%`)
          ))
          .limit(3);

        // Filter to the right one
        const match = found.find(rider =>
          r.name.toLowerCase().split(" ").some(part => rider.name.toLowerCase().includes(part.toLowerCase()) && part.length > 3)
        );

        if (match) {
          await db.insert(raceResults).values({
            id: crypto.randomUUID(),
            raceId: menRace.id,
            riderId: match.id,
            position: r.position,
          }).onConflictDoNothing();
          console.log(`  P${r.position}: ${match.name} ✅`);
        } else {
          console.log(`  P${r.position}: ${r.name} — rider not found in DB, skipping`);
        }
      }

      // Mark race completed
      await db.update(races).set({ status: "completed" }).where(eq(races.id, menRace.id));
      console.log("  Race marked completed ✅");
    }
  }

  // ── Elite Women results ────────────────────────────────────────────────────
  // Source: creuse-oxygene.com — "victoire de Léna Gérault (SCOTT Creuse Oxygène Guéret)"
  if (womenRace) {
    console.log(`\n[Women] Inserting results for race ${womenRace.id}`);

    const existing = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, womenRace.id));
    if (existing.length > 0) {
      console.log(`  Already has ${existing.length} results — skipping`);
    } else {
      const found = await db.select({ id: riders.id, name: riders.name })
        .from(riders)
        .where(ilike(riders.name, "%Gérault%"))
        .limit(3);

      // Try ASCII variant
      const found2 = found.length === 0
        ? await db.select({ id: riders.id, name: riders.name }).from(riders).where(ilike(riders.name, "%Gerault%")).limit(3)
        : found;

      if (found2.length > 0) {
        await db.insert(raceResults).values({
          id: crypto.randomUUID(),
          raceId: womenRace.id,
          riderId: found2[0].id,
          position: 1,
        }).onConflictDoNothing();
        console.log(`  P1: ${found2[0].name} ✅`);
        await db.update(races).set({ status: "completed" }).where(eq(races.id, womenRace.id));
        console.log("  Race marked completed ✅");
      } else {
        console.log("  Léna Gérault not found in DB — rider needs to be added manually");
        console.log("  Race not marked completed");
      }
    }
  } else {
    console.log("\n[Women] No women's Chabrières race found — was likely purged as phantom ✅");
  }

  console.log("\nDone.");
}

main().catch(console.error);
