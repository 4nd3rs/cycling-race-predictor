/**
 * Stage Favorites — re-rank parent race predictions by stage terrain.
 *
 * Takes the parent race's top predictions and adjusts ranking based on
 * each rider's profile affinities and the stage's profile type.
 */

import { db, predictions, riders, riderDisciplineStats } from "@/lib/db";
import { eq, asc, and } from "drizzle-orm";
import { profileAffinityMultiplier } from "./profile";

export interface StageFavorite {
  riderId: string;
  name: string;
  winPct: number;
  photoUrl: string | null;
}

/**
 * Get stage-specific favorites by re-ranking parent race predictions
 * using the rider's profile affinities for the given stage terrain.
 */
export async function getStageFavorites(
  parentRaceId: string,
  stageProfileType: string | null,
  discipline: string,
  limit: number = 5,
): Promise<StageFavorite[]> {
  // Fetch parent race top predictions (get more than we need for re-ranking)
  const topPredictions = await db
    .select({
      riderId: predictions.riderId,
      winProbability: predictions.winProbability,
      predictedPosition: predictions.predictedPosition,
      riderName: riders.name,
      riderPhoto: riders.photoUrl,
    })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, parentRaceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(20);

  if (topPredictions.length === 0) return [];

  // If no stage profile, return overall favorites
  if (!stageProfileType) {
    return topPredictions.slice(0, limit).map((p) => ({
      riderId: p.riderId,
      name: p.riderName,
      winPct: p.winProbability ? Number(p.winProbability) * 100 : 0,
      photoUrl: p.riderPhoto ?? null,
    }));
  }

  // Fetch profile affinities for all riders
  const riderIds = topPredictions.map((p) => p.riderId);
  const statsRows = await db
    .select({
      riderId: riderDisciplineStats.riderId,
      profileAffinities: riderDisciplineStats.profileAffinities,
      racesTotal: riderDisciplineStats.racesTotal,
    })
    .from(riderDisciplineStats)
    .where(
      and(
        eq(riderDisciplineStats.discipline, discipline),
        // Match any of these rider IDs — drizzle inArray
      )
    );

  // Build lookup
  const affinityMap = new Map<
    string,
    { affinity: number; sampleSize: number }
  >();
  for (const row of statsRows) {
    if (riderIds.includes(row.riderId)) {
      const affinities = row.profileAffinities as Record<string, number> | null;
      const affinity = affinities?.[stageProfileType] ?? 0.5;
      // Estimate sample size from total races (conservative)
      const sampleSize = Math.min(row.racesTotal ?? 0, 10);
      affinityMap.set(row.riderId, { affinity, sampleSize });
    }
  }

  // Re-rank: multiply base win probability by profile affinity multiplier
  const reranked = topPredictions.map((p) => {
    const baseWinPct = p.winProbability ? Number(p.winProbability) * 100 : 0;
    const stats = affinityMap.get(p.riderId);
    const multiplier = stats
      ? profileAffinityMultiplier(stats.affinity, stats.sampleSize)
      : 1.0;

    return {
      riderId: p.riderId,
      name: p.riderName,
      winPct: baseWinPct * multiplier,
      photoUrl: p.riderPhoto ?? null,
    };
  });

  // Sort by adjusted win probability (descending)
  reranked.sort((a, b) => b.winPct - a.winPct);

  return reranked.slice(0, limit);
}
