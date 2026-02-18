/**
 * Sync UCI Rankings from XCOdata
 *
 * Fetches complete UCI rankings from xcodata.com and matches them to riders in the database.
 * XCOdata provides full rankings (500+ riders) unlike UCI DataRide (only top 40).
 * Used for MTB race predictions.
 */

import { db, riders, riderDisciplineStats, raceStartlist } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { scrapeXCOdataRankings, findRiderInXCOdataRankings, type XCOdataRider } from "./xcodata";
import { scrapeUCIRankings, findRiderInUCIRankings } from "./uci-dataride";

/**
 * Sync UCI rankings for all riders in a specific race
 * Uses XCOdata for complete rankings (not just top 40)
 */
export async function syncUciRankingsForRace(
  raceId: string,
  maxPages: number = 25 // Fetch up to 25 pages (~625 riders)
): Promise<{ synced: number; notFound: number; skipped: number; cleaned: number }> {
  // Get race details
  const [race] = await db.query.races.findMany({
    where: (races, { eq }) => eq(races.id, raceId),
    limit: 1,
  });

  if (!race) {
    throw new Error("Race not found");
  }

  if (race.discipline !== "mtb") {
    return { synced: 0, notFound: 0, skipped: 0, cleaned: 0 };
  }

  const ageCategory = race.ageCategory || "elite";
  const gender = race.gender || "men";

  console.log(`Fetching UCI ${ageCategory} ${gender} rankings for race ${race.name}...`);

  // Fetch UCI rankings from XCOdata (complete rankings)
  const uciRankings = await scrapeXCOdataRankings(ageCategory, gender, maxPages);
  if (uciRankings.length === 0) {
    console.log("No rankings fetched from XCOdata");
    return { synced: 0, notFound: 0, skipped: 0, cleaned: 0 };
  }

  console.log(`Fetched ${uciRankings.length} riders from UCI rankings`);

  // Get all riders in this race's startlist
  const startlist = await db.query.raceStartlist.findMany({
    where: (raceStartlist, { eq }) => eq(raceStartlist.raceId, raceId),
    with: {
      rider: true,
    },
  });

  console.log(`Race has ${startlist.length} riders in startlist`);

  let synced = 0;
  let notFound = 0;
  let skipped = 0;

  for (const entry of startlist) {
    const rider = entry.rider;
    if (!rider) {
      skipped++;
      continue;
    }

    // Try to find match in UCI rankings
    const match = findRiderInXCOdataRankings(rider.name, uciRankings);

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

      // Calculate Elo from UCI points (rough conversion)
      // Top riders (2000+ pts) → ~2000 Elo, lower-ranked → scaled down
      const eloFromPoints = Math.round(1000 + match.uciPoints / 2);
      const eloStr = String(Math.min(2500, Math.max(1000, eloFromPoints)));

      if (existingStats) {
        // Update existing stats — only touch ELO fields if rider has no race data
        const eloVariance = match.rank <= 50 ? "80" : match.rank <= 200 ? "120" : "180";
        const updates: Record<string, unknown> = {
          uciPoints: match.uciPoints,
          uciRank: match.rank,
          updatedAt: new Date(),
        };
        if ((existingStats.racesTotal ?? 0) === 0) {
          updates.eloMean = eloStr;
          updates.eloVariance = eloVariance;
          const mean = parseFloat(eloStr);
          const variance = parseFloat(eloVariance);
          updates.currentElo = String(Math.max(0, Math.round((mean - 3 * variance) * 100) / 100));
        }
        await db
          .update(riderDisciplineStats)
          .set(updates)
          .where(eq(riderDisciplineStats.id, existingStats.id));
      } else {
        // Create new stats with conservative currentElo
        const eloVariance = match.rank <= 50 ? "80" : match.rank <= 200 ? "120" : "180";
        const mean = parseFloat(eloStr);
        const variance = parseFloat(eloVariance);
        const conservativeElo = String(Math.max(0, Math.round((mean - 3 * variance) * 100) / 100));
        await db.insert(riderDisciplineStats).values({
          riderId: rider.id,
          discipline: race.discipline,
          ageCategory,
          uciPoints: match.uciPoints,
          uciRank: match.rank,
          eloMean: eloStr,
          currentElo: conservativeElo,
          eloVariance,
        });
      }

      // Update XCO ID and nationality on rider if found
      const riderUpdates: { xcoId?: string; nationality?: string } = {};
      if (match.xcoId && !rider.xcoId) {
        riderUpdates.xcoId = match.xcoId;
      }
      if (match.nationality && !rider.nationality) {
        riderUpdates.nationality = match.nationality;
      }
      if (Object.keys(riderUpdates).length > 0) {
        await db
          .update(riders)
          .set(riderUpdates)
          .where(eq(riders.id, rider.id));
      }

      synced++;
      console.log(`  ✓ ${rider.name} → UCI #${match.rank} (${match.uciPoints} pts)`);
    } else {
      notFound++;
      // Still create basic stats for unranked riders
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

      if (!existingStats) {
        // Conservative currentElo for unranked: 1000 - 3*350 = -50 → clamped to 0
        await db.insert(riderDisciplineStats).values({
          riderId: rider.id,
          discipline: race.discipline,
          ageCategory,
          uciPoints: 0,
          eloMean: "1000",
          currentElo: "0",
          eloVariance: "350",
        });
      }
    }
  }

  // Fetch age data from UCI DataRide (optional, requires FIRECRAWL_API_KEY)
  let agesUpdated = 0;
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      console.log(`\nFetching age data from UCI DataRide...`);
      const uciRankings = await scrapeUCIRankings(ageCategory, gender);
      if (uciRankings.length > 0) {
        for (const entry of startlist) {
          const rider = entry.rider;
          if (!rider || rider.birthDate) continue;

          const uciMatch = findRiderInUCIRankings(rider.name, uciRankings);
          if (uciMatch?.age) {
            const birthYear = new Date().getFullYear() - uciMatch.age;
            const riderUpdates: Record<string, string> = {};
            riderUpdates.birthDate = `${birthYear}-01-01`;
            if (uciMatch.uciId && !rider.uciId) riderUpdates.uciId = uciMatch.uciId;

            await db.update(riders).set(riderUpdates).where(eq(riders.id, rider.id));
            agesUpdated++;
          }
        }
        console.log(`  Updated age for ${agesUpdated} riders`);
      }
    } catch (error) {
      console.error("Error fetching UCI DataRide ages:", error);
    }
  }

  // Clean misclassified riders by checking opposite gender rankings
  let cleaned = 0;
  const oppositeGender = gender === "men" ? "women" : "men";

  console.log(`\nChecking for misclassified riders (checking ${oppositeGender} rankings)...`);
  const oppositeRankings = await scrapeXCOdataRankings(ageCategory, oppositeGender, 15);

  if (oppositeRankings.length > 0) {
    // Re-fetch startlist to get current state
    const currentStartlist = await db.query.raceStartlist.findMany({
      where: (raceStartlist, { eq }) => eq(raceStartlist.raceId, raceId),
      with: {
        rider: true,
      },
    });

    const idsToRemove: string[] = [];
    for (const entry of currentStartlist) {
      const rider = entry.rider;
      if (!rider) continue;

      const wrongGenderMatch = findRiderInXCOdataRankings(rider.name, oppositeRankings);
      if (wrongGenderMatch) {
        idsToRemove.push(entry.id);
        console.log(`  ✗ Removing ${rider.name} (found in ${oppositeGender} rankings #${wrongGenderMatch.rank})`);
      }
    }

    if (idsToRemove.length > 0) {
      await db
        .delete(raceStartlist)
        .where(inArray(raceStartlist.id, idsToRemove));
      cleaned = idsToRemove.length;
    }
  }

  console.log(`\nSync complete: ${synced} matched, ${notFound} not found, ${skipped} skipped, ${cleaned} cleaned`);
  return { synced, notFound, skipped, cleaned };
}

/**
 * Sync UCI rankings for all races in a category
 * Useful for bulk updates
 */
export async function syncUciRankingsForCategory(
  ageCategory: string,
  gender: string,
  maxPages: number = 30
): Promise<{ total: number; synced: number }> {
  console.log(`Fetching complete ${ageCategory} ${gender} rankings...`);

  const rankings = await scrapeXCOdataRankings(ageCategory, gender, maxPages);
  if (rankings.length === 0) {
    return { total: 0, synced: 0 };
  }

  console.log(`Got ${rankings.length} riders, syncing to database...`);

  let synced = 0;

  for (const ranking of rankings) {
    // Find rider by name in database
    const [existingRider] = await db
      .select()
      .from(riders)
      .where(eq(riders.name, ranking.name))
      .limit(1);

    if (!existingRider) {
      // Could create new rider here if desired
      continue;
    }

    // Use "mtb" as the canonical discipline
    const discipline = "mtb";

    // Find or create discipline stats
    const [existingStats] = await db
      .select()
      .from(riderDisciplineStats)
      .where(
        and(
          eq(riderDisciplineStats.riderId, existingRider.id),
          eq(riderDisciplineStats.discipline, discipline),
          eq(riderDisciplineStats.ageCategory, ageCategory)
        )
      )
      .limit(1);

    const eloFromPoints = Math.round(1000 + ranking.uciPoints / 2);
    const eloStr = String(Math.min(2500, Math.max(1000, eloFromPoints)));

    if (existingStats) {
      // Only touch ELO fields if rider has no race data
      const updates: Record<string, unknown> = {
        uciPoints: ranking.uciPoints,
        uciRank: ranking.rank,
        updatedAt: new Date(),
      };
      if ((existingStats.racesTotal ?? 0) === 0) {
        const eloVariance = ranking.rank <= 50 ? "80" : "150";
        updates.eloMean = eloStr;
        updates.eloVariance = eloVariance;
        const mean = parseFloat(eloStr);
        const variance = parseFloat(eloVariance);
        updates.currentElo = String(Math.max(0, Math.round((mean - 3 * variance) * 100) / 100));
      }
      await db
        .update(riderDisciplineStats)
        .set(updates)
        .where(eq(riderDisciplineStats.id, existingStats.id));
    } else {
      const eloVariance = ranking.rank <= 50 ? "80" : "150";
      const mean = parseFloat(eloStr);
      const variance = parseFloat(eloVariance);
      const conservativeElo = String(Math.max(0, Math.round((mean - 3 * variance) * 100) / 100));
      await db.insert(riderDisciplineStats).values({
        riderId: existingRider.id,
        discipline,
        ageCategory,
        uciPoints: ranking.uciPoints,
        uciRank: ranking.rank,
        eloMean: eloStr,
        currentElo: conservativeElo,
        eloVariance,
      });
    }

    // Update XCO ID
    if (ranking.xcoId && !existingRider.xcoId) {
      await db
        .update(riders)
        .set({ xcoId: ranking.xcoId })
        .where(eq(riders.id, existingRider.id));
    }

    synced++;
  }

  console.log(`Synced ${synced} riders for ${ageCategory} ${gender}`);
  return { total: rankings.length, synced };
}
