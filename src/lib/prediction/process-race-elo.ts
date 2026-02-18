import {
  db,
  races,
  raceResults,
  riders,
  riderDisciplineStats,
  eloHistory,
  predictions,
  raceStartlist,
} from "@/lib/db";
import {
  processRace,
  calculateElo,
  createInitialSkill,
  type RiderSkill,
  type RaceResult,
} from "@/lib/prediction";
import { eq, and, inArray, sql } from "drizzle-orm";

/**
 * Process ELO updates for a single race.
 * Creates riderDisciplineStats if needed, updates ELO, and records history.
 * Returns the number of rider updates, or null if skipped.
 */
export async function processRaceElo(raceId: string): Promise<number | null> {
  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);

  if (!race) return null;

  // Check if already processed
  const [existing] = await db
    .select({ id: eloHistory.id })
    .from(eloHistory)
    .where(eq(eloHistory.raceId, raceId))
    .limit(1);

  if (existing) return null;

  // Get race results
  const raceResultsData = await db
    .select({
      result: raceResults,
      rider: riders,
    })
    .from(raceResults)
    .innerJoin(riders, eq(raceResults.riderId, riders.id))
    .where(eq(raceResults.raceId, raceId));

  if (raceResultsData.length < 2) return null;

  // Track which stats entry ID to update per rider
  const riderStatsId = new Map<string, string>();

  // Build skills map from current ELO
  const skillsMap = new Map<string, RiderSkill>();

  for (const { rider } of raceResultsData) {
    const existingStats = await db
      .select()
      .from(riderDisciplineStats)
      .where(
        and(
          eq(riderDisciplineStats.riderId, rider.id),
          eq(riderDisciplineStats.discipline, race.discipline)
        )
      )
      .limit(1);

    const stats = existingStats[0];

    if (stats) {
      riderStatsId.set(rider.id, stats.id);
      skillsMap.set(rider.id, {
        riderId: rider.id,
        mean: parseFloat(stats.eloMean || "1500"),
        variance: parseFloat(stats.eloVariance || "350") ** 2,
      });
    } else {
      const initialSkill = createInitialSkill(rider.id);
      skillsMap.set(rider.id, initialSkill);

      const [newStats] = await db.insert(riderDisciplineStats).values({
        riderId: rider.id,
        discipline: race.discipline,
        ageCategory: race.ageCategory || "elite",
        currentElo: "1500",
        eloMean: "1500",
        eloVariance: "350",
      }).returning({ id: riderDisciplineStats.id });

      riderStatsId.set(rider.id, newStats.id);
    }
  }

  // Format results for processing (exclude DNS and null positions)
  const raceResultsForElo: RaceResult[] = raceResultsData
    .filter(({ result }) => result.position !== null && !result.dns)
    .map(({ result, rider }) => ({
      riderId: rider.id,
      position: result.position!,
      dnf: result.dnf || false,
    }));

  if (raceResultsForElo.length < 2) return null;

  // Process race and update ELO
  const updates = processRace(raceResultsForElo, skillsMap);

  // Save updates to database
  for (const update of updates) {
    const newElo = calculateElo(update.newMean, update.newVariance);
    const oldElo = calculateElo(update.oldMean, update.oldVariance);

    const riderResult = raceResultsData.find(
      (r) => r.rider.id === update.riderId
    );
    const pos = riderResult?.result.position ?? 0;
    const statsId = riderStatsId.get(update.riderId);

    if (statsId) {
      await db
        .update(riderDisciplineStats)
        .set({
          currentElo: newElo.toString(),
          eloMean: update.newMean.toString(),
          eloVariance: Math.sqrt(update.newVariance).toString(),
          winsTotal: sql`${riderDisciplineStats.winsTotal} + ${pos === 1 ? 1 : 0}`,
          podiumsTotal: sql`${riderDisciplineStats.podiumsTotal} + ${pos > 0 && pos <= 3 ? 1 : 0}`,
          racesTotal: sql`${riderDisciplineStats.racesTotal} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(riderDisciplineStats.id, statsId));
    }

    await db.insert(eloHistory).values({
      riderId: update.riderId,
      raceId: race.id,
      discipline: race.discipline,
      ageCategory: race.ageCategory || "elite",
      eloBefore: oldElo.toString(),
      eloAfter: newElo.toString(),
      eloChange: update.eloChange.toString(),
      racePosition: pos > 0 ? pos : null,
    });
  }

  // Invalidate cached predictions for upcoming races that include updated riders
  const updatedRiderIds = updates.map((u) => u.riderId);
  if (updatedRiderIds.length > 0) {
    const affectedRaceIds = await db
      .selectDistinct({ raceId: raceStartlist.raceId })
      .from(raceStartlist)
      .where(inArray(raceStartlist.riderId, updatedRiderIds));

    for (const { raceId: affectedRaceId } of affectedRaceIds) {
      if (affectedRaceId === raceId) continue; // Skip the race we just processed
      await db
        .delete(predictions)
        .where(eq(predictions.raceId, affectedRaceId));
    }
  }

  return updates.length;
}
