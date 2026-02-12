/**
 * Sync SuperCup MTB Standings
 *
 * Fetches SuperCup standings from supercupmtb.com PDFs and matches them
 * to riders in the database. Follows the same pattern as sync-uci-rankings.ts.
 */

import { db, riders, riderDisciplineStats, raceStartlist } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { scrapeSupercupStandings, findRiderInSupercupStandings } from "./supercup";

/**
 * Sync SuperCup standings for all riders in a specific race
 */
export async function syncSupercupForRace(
  raceId: string
): Promise<{ synced: number; notFound: number; skipped: number }> {
  // Get race details
  const [race] = await db.query.races.findMany({
    where: (races, { eq }) => eq(races.id, raceId),
    limit: 1,
  });

  if (!race) {
    throw new Error("Race not found");
  }

  if (!race.discipline.startsWith("mtb")) {
    return { synced: 0, notFound: 0, skipped: 0 };
  }

  const ageCategory = race.ageCategory || "elite";
  const gender = race.gender || "men";

  console.log(`[SuperCup Sync] Fetching SuperCup standings for ${ageCategory} ${gender}...`);

  // Fetch standings from SuperCup PDF
  const standings = await scrapeSupercupStandings(ageCategory, gender);
  if (standings.length === 0) {
    console.log("[SuperCup Sync] No standings fetched");
    return { synced: 0, notFound: 0, skipped: 0 };
  }

  console.log(`[SuperCup Sync] Fetched ${standings.length} riders from SuperCup standings`);

  // Get all riders in this race's startlist
  const startlist = await db.query.raceStartlist.findMany({
    where: (raceStartlist, { eq }) => eq(raceStartlist.raceId, raceId),
    with: {
      rider: true,
    },
  });

  console.log(`[SuperCup Sync] Race has ${startlist.length} riders in startlist`);

  let synced = 0;
  let notFound = 0;
  let skipped = 0;

  for (const entry of startlist) {
    const rider = entry.rider;
    if (!rider) {
      skipped++;
      continue;
    }

    // Try to find match in SuperCup standings
    const match = findRiderInSupercupStandings(rider.name, standings);

    if (match) {
      // Find or create discipline stats
      const [existingStats] = await db
        .select()
        .from(riderDisciplineStats)
        .where(
          and(
            eq(riderDisciplineStats.riderId, rider.id),
            eq(riderDisciplineStats.discipline, race.discipline),
            eq(riderDisciplineStats.ageCategory, ageCategory)
          )
        )
        .limit(1);

      if (existingStats) {
        // Update existing stats with SuperCup data
        await db
          .update(riderDisciplineStats)
          .set({
            supercupPoints: match.totalPoints,
            supercupRank: match.rank,
            updatedAt: new Date(),
          })
          .where(eq(riderDisciplineStats.id, existingStats.id));
      } else {
        // Create new stats with SuperCup data
        await db.insert(riderDisciplineStats).values({
          riderId: rider.id,
          discipline: race.discipline,
          ageCategory,
          supercupPoints: match.totalPoints,
          supercupRank: match.rank,
          eloMean: "1000",
          currentElo: "1000",
          eloVariance: "350",
        });
      }

      synced++;
      console.log(`  ✓ ${rider.name} → SuperCup #${match.rank} (${match.totalPoints} pts)`);
    } else {
      notFound++;
    }
  }

  console.log(`[SuperCup Sync] Complete: ${synced} matched, ${notFound} not found, ${skipped} skipped`);
  return { synced, notFound, skipped };
}
