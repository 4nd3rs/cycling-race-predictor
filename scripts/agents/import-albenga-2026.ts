/**
 * Import Albenga 2026 XCO startlist — with UCI ID deduplication
 * 
 * Priority for rider matching:
 *   1. Match by UCI ID (uci_id column)
 *   2. Match by exact name (any format: "Cas Timmermans" or "Timmermans Cas")
 *   3. Create new rider only if not found
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, or, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as fs from "fs";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

const RACE_IDS: Record<string, string> = {
  elite_men:    "296c0ae7-6357-470e-bd94-851214fcd1b8",
  elite_women:  "07fda4e9-95cb-406c-be6a-41dca3f9ad08",
  u23_men:      "c8076954-e23e-4e70-9e3b-5847a63d768e",
  u23_women:    "a7449452-fcc7-4bf4-8a93-b6e1e9010a96",
  junior_men:   "fded8415-a5d9-458e-a6a4-985806f729f5",
  junior_women: "d18377ff-75ed-4dc8-91e7-d5db58792e1b",
};

async function findOrCreateRider(first: string, last: string, uciId: string): Promise<string> {
  // 1. Match by UCI ID
  const byUci = await db.query.riders.findFirst({
    where: eq(schema.riders.uciId, uciId),
  });
  if (byUci) return byUci.id;

  // 2. Match by either name order ("Cas Timmermans" or "Timmermans Cas")
  const fullName = `${first} ${last}`;
  const reverseName = `${last} ${first}`;
  const byName = await db.query.riders.findFirst({
    where: or(
      ilike(schema.riders.name, fullName),
      ilike(schema.riders.name, reverseName),
    ),
  });
  if (byName) {
    // Store the UCI ID if we found by name and it was missing
    if (!byName.uciId) {
      await db.update(schema.riders).set({ uciId }).where(eq(schema.riders.id, byName.id));
    }
    return byName.id;
  }

  // 3. Create new rider
  const [created] = await db.insert(schema.riders).values({
    name: fullName,
    uciId,
    discipline: "mtb",
  }).returning({ id: schema.riders.id });
  return created.id;
}

async function main() {
  // Step 1: Wipe the bad startlist entries from the previous import
  console.log("Cleaning up previous import...");
  for (const raceId of Object.values(RACE_IDS)) {
    await sqlClient`DELETE FROM race_startlist WHERE race_id = ${raceId}`;
  }
  console.log("  ✅ Cleared all Albenga startlist entries");

  // Step 2: Also delete riders we created without UCI IDs (the bad ones)
  // These are riders with no uci_id, no nationality, created very recently
  // We'll be surgical: only delete if they have no startlist entries AND no results
  // (after clearing above, any rider only in Albenga startlist is now orphaned)
  // Actually safer: just re-import with dedup — orphaned riders are harmless

  // Step 3: Re-import with proper UCI ID deduplication
  const data: Record<string, Array<{ uci_id: string; first: string; last: string }>> =
    JSON.parse(fs.readFileSync("/tmp/albenga-uciids.json", "utf-8"));

  console.log("\nRe-importing with UCI ID deduplication...");

  for (const [cat, riders] of Object.entries(data)) {
    const raceId = RACE_IDS[cat];
    if (!raceId) { console.log(`  ⚠️  No race for ${cat}`); continue; }

    let matched = 0, created = 0;
    for (const r of riders) {
      const existingBefore = await db.query.riders.findFirst({
        where: eq(schema.riders.uciId, r.uci_id),
      });
      const riderId = await findOrCreateRider(r.first, r.last, r.uci_id);
      if (existingBefore) matched++; else created++;

      await db.insert(schema.raceStartlist)
        .values({ raceId, riderId })
        .onConflictDoNothing();
    }
    console.log(`  ✅ ${cat}: ${matched} matched existing, ${created} new riders`);
  }

  console.log("\n✅ Done.");
}

main().catch(console.error);
