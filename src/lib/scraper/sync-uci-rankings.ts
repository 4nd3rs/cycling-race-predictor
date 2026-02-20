/**
 * Sync UCI Rankings for a Race
 *
 * Fetches complete UCI rankings from the DataRide API and matches them
 * to riders in the database. Used for MTB race predictions.
 */

import { db, riders, riderDisciplineStats, raceStartlist } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  fetchAllUCIRankings,
  findRiderByUciId,
  findRiderByName,
  type UCIRankingCategory,
  type UCIRankingRider,
} from "./uci-rankings-api";

/**
 * Map gender + ageCategory to UCIRankingCategory.
 */
function toUCICategory(gender: string, ageCategory: string): UCIRankingCategory | null {
  const key = `${gender}_${ageCategory}`;
  if (key === "men_elite" || key === "women_elite" || key === "men_junior" || key === "women_junior") {
    return key as UCIRankingCategory;
  }
  // U23 riders use Elite rankings
  if (ageCategory === "u23") {
    return `${gender}_elite` as UCIRankingCategory;
  }
  return null;
}

/**
 * Find a matching rider in rankings, preferring UCI ID match over name match.
 */
function findRiderInRankings(
  rider: { name: string; uciId: string | null },
  rankings: UCIRankingRider[]
): UCIRankingRider | null {
  if (rider.uciId) {
    const match = findRiderByUciId(rider.uciId, rankings);
    if (match) return match;
  }
  return findRiderByName(rider.name, rankings);
}

/**
 * Sync UCI rankings for all riders in a specific race.
 */
export async function syncUciRankingsForRace(
  raceId: string
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
  const category = toUCICategory(gender, ageCategory);

  if (!category) {
    console.log(`No UCI ranking category for ${ageCategory} ${gender}`);
    return { synced: 0, notFound: 0, skipped: 0, cleaned: 0 };
  }

  console.log(`Fetching UCI ${ageCategory} ${gender} rankings for race ${race.name}...`);

  // Fetch UCI rankings from DataRide API
  const uciRankings = await fetchAllUCIRankings(category);
  if (uciRankings.length === 0) {
    console.log("No rankings fetched from UCI DataRide");
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

    const match = findRiderInRankings(rider, uciRankings);

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

      // Calculate Elo from UCI points
      const eloFromPoints = Math.round(1000 + match.points / 2);
      const eloStr = String(Math.min(2500, Math.max(1000, eloFromPoints)));

      if (existingStats) {
        const eloVariance = match.rank <= 50 ? "80" : match.rank <= 200 ? "120" : "180";
        const updates: Record<string, unknown> = {
          uciPoints: match.points,
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
        const eloVariance = match.rank <= 50 ? "80" : match.rank <= 200 ? "120" : "180";
        const mean = parseFloat(eloStr);
        const variance = parseFloat(eloVariance);
        const conservativeElo = String(Math.max(0, Math.round((mean - 3 * variance) * 100) / 100));
        await db.insert(riderDisciplineStats).values({
          riderId: rider.id,
          discipline: race.discipline,
          ageCategory,
          gender,
          uciPoints: match.points,
          uciRank: match.rank,
          eloMean: eloStr,
          currentElo: conservativeElo,
          eloVariance,
        });
      }

      // Update UCI ID, birthDate, and nationality on rider if found
      const riderUpdates: Record<string, string> = {};
      if (match.uciId && !rider.uciId) riderUpdates.uciId = match.uciId;
      if (match.birthDate && !rider.birthDate) riderUpdates.birthDate = match.birthDate;
      if (match.countryIso2 && !rider.nationality) {
        const { normalizeNationality } = await import("@/lib/nationality-codes");
        const nat = normalizeNationality(match.countryIso2);
        if (nat) riderUpdates.nationality = nat;
      }
      if (Object.keys(riderUpdates).length > 0) {
        await db
          .update(riders)
          .set(riderUpdates)
          .where(eq(riders.id, rider.id));
      }

      synced++;
      console.log(`  ✓ ${rider.name} → UCI #${match.rank} (${match.points} pts)`);
    } else {
      notFound++;
      // Create basic stats for unranked riders
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
        await db.insert(riderDisciplineStats).values({
          riderId: rider.id,
          discipline: race.discipline,
          ageCategory,
          gender,
          uciPoints: 0,
          eloMean: "1000",
          currentElo: "0",
          eloVariance: "350",
        });
      }
    }
  }

  // Clean misclassified riders by checking opposite gender rankings
  let cleaned = 0;
  const oppositeGender = gender === "men" ? "women" : "men";
  const oppositeCategory = toUCICategory(oppositeGender, ageCategory);

  if (oppositeCategory) {
    console.log(`\nChecking for misclassified riders (checking ${oppositeGender} rankings)...`);
    const oppositeRankings = await fetchAllUCIRankings(oppositeCategory);

    if (oppositeRankings.length > 0) {
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

        const wrongGenderMatch = findRiderInRankings(rider, oppositeRankings);
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
  }

  console.log(`\nSync complete: ${synced} matched, ${notFound} not found, ${skipped} skipped, ${cleaned} cleaned`);
  return { synced, notFound, skipped, cleaned };
}

/**
 * Sync UCI rankings for all riders in a category.
 */
export async function syncUciRankingsForCategory(
  ageCategory: string,
  gender: string
): Promise<{ total: number; synced: number }> {
  const category = toUCICategory(gender, ageCategory);
  if (!category) {
    return { total: 0, synced: 0 };
  }

  console.log(`Fetching complete ${ageCategory} ${gender} rankings...`);

  const rankings = await fetchAllUCIRankings(category);
  if (rankings.length === 0) {
    return { total: 0, synced: 0 };
  }

  console.log(`Got ${rankings.length} riders, syncing to database...`);

  let synced = 0;

  for (const ranking of rankings) {
    // Find rider by UCI ID or name
    let existingRider;
    if (ranking.uciId) {
      [existingRider] = await db
        .select()
        .from(riders)
        .where(eq(riders.uciId, ranking.uciId))
        .limit(1);
    }
    if (!existingRider) {
      [existingRider] = await db
        .select()
        .from(riders)
        .where(eq(riders.name, ranking.name))
        .limit(1);
    }

    if (!existingRider) continue;

    const discipline = "mtb";

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

    const eloFromPoints = Math.round(1000 + ranking.points / 2);
    const eloStr = String(Math.min(2500, Math.max(1000, eloFromPoints)));

    if (existingStats) {
      const updates: Record<string, unknown> = {
        uciPoints: ranking.points,
        uciRank: ranking.rank,
        gender,
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
        gender,
        uciPoints: ranking.points,
        uciRank: ranking.rank,
        eloMean: eloStr,
        currentElo: conservativeElo,
        eloVariance,
      });
    }

    // Update UCI ID and birthDate on rider
    const riderUpdates: Record<string, string> = {};
    if (ranking.uciId && !existingRider.uciId) riderUpdates.uciId = ranking.uciId;
    if (ranking.birthDate && !existingRider.birthDate) riderUpdates.birthDate = ranking.birthDate;
    if (Object.keys(riderUpdates).length > 0) {
      await db
        .update(riders)
        .set(riderUpdates)
        .where(eq(riders.id, existingRider.id));
    }

    synced++;
  }

  console.log(`Synced ${synced} riders for ${ageCategory} ${gender}`);
  return { total: rankings.length, synced };
}
