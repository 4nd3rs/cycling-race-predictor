/**
 * UCI Database Sync
 *
 * Mirrors the complete UCI rankings database into our system.
 * Creates riders it discovers, stores all available data, and prevents duplicates.
 * Uses the UCI DataRide JSON API directly — no HTML scraping needed.
 */

import { db, riderDisciplineStats, uciSyncRuns } from "@/lib/db";
import { eq, and, lt } from "drizzle-orm";
import { fetchAllUCIRankings, type UCIRankingCategory } from "./uci-rankings-api";
import { findOrCreateRider, findOrCreateTeam } from "@/lib/riders/find-or-create";
import { normalizeNationality } from "@/lib/nationality-codes";

export interface SyncResult {
  syncRunId: string;
  status: "completed" | "failed";
  durationMs: number;
  totalEntries: number;
  ridersCreated: number;
  ridersUpdated: number;
  teamsCreated: number;
  errors: string[];
  categoryDetails: Array<{
    category: string;
    entries: number;
    ridersCreated: number;
    ridersUpdated: number;
  }>;
}

const CATEGORIES: UCIRankingCategory[] = [
  "men_elite",
  "women_elite",
  "men_junior",
  "women_junior",
];

/**
 * Sync the complete UCI rankings database for a discipline.
 */
export async function syncUciDatabase(options: {
  discipline: "mtb";
  maxPagesPerCategory?: number;
}): Promise<SyncResult> {
  const { discipline } = options;
  const startTime = Date.now();

  // Create sync run record
  const [syncRun] = await db
    .insert(uciSyncRuns)
    .values({
      discipline,
      source: "uci_dataride",
      status: "running",
    })
    .returning();

  const result: SyncResult = {
    syncRunId: syncRun.id,
    status: "completed",
    durationMs: 0,
    totalEntries: 0,
    ridersCreated: 0,
    ridersUpdated: 0,
    teamsCreated: 0,
    errors: [],
    categoryDetails: [],
  };

  const syncStartedAt = new Date();

  try {
    for (const category of CATEGORIES) {
      const [gender, ageCategory] = category.split("_");
      const categoryStart = Date.now();
      let categoryRidersCreated = 0;
      let categoryRidersUpdated = 0;

      try {
        console.log(`[sync] Fetching ${category} rankings from UCI DataRide...`);
        const rankings = await fetchAllUCIRankings(category);

        if (rankings.length === 0) {
          result.errors.push(`No rankings found for ${category}`);
          continue;
        }

        console.log(`[sync] Processing ${rankings.length} riders for ${category}`);

        for (const ranking of rankings) {
          try {
            const nat = normalizeNationality(ranking.countryIso2) || normalizeNationality(ranking.nationality);

            // Find or create team
            let teamId: string | null = null;
            if (ranking.teamName) {
              const team = await findOrCreateTeam(ranking.teamName, discipline);
              teamId = team.id;
            }

            // Find or create rider — pass uciId and birthDate directly from the API
            const riderBefore = await db.query.riders.findFirst({
              where: (riders, { eq }) =>
                ranking.uciId ? eq(riders.uciId, ranking.uciId) : eq(riders.name, "__impossible__"),
            });

            const rider = await findOrCreateRider({
              name: ranking.name,
              uciId: ranking.uciId || null,
              nationality: nat,
              birthDate: ranking.birthDate || null,
              teamId,
            });

            if (!riderBefore) {
              categoryRidersCreated++;
            } else {
              categoryRidersUpdated++;
            }

            // Upsert discipline stats
            const [existingStats] = await db
              .select()
              .from(riderDisciplineStats)
              .where(
                and(
                  eq(riderDisciplineStats.riderId, rider.id),
                  eq(riderDisciplineStats.discipline, discipline),
                  eq(riderDisciplineStats.ageCategory, ageCategory)
                )
              )
              .limit(1);

            // ELO from UCI points
            const estimatedElo = 1500 + (ranking.points / 3000) * 500;
            const eloVariance = 350;

            if (existingStats) {
              // Always update UCI points and rank
              const updates: Record<string, unknown> = {
                uciPoints: ranking.points,
                uciRank: ranking.rank,
                teamId,
                gender,
                updatedAt: new Date(),
              };

              // Only update ELO if rider has no race data
              if ((existingStats.racesTotal ?? 0) === 0) {
                const variance = parseFloat(existingStats.eloVariance || "350");
                const conservativeElo = Math.max(0, estimatedElo - 3 * variance);
                updates.eloMean = estimatedElo.toFixed(4);
                updates.eloVariance = String(variance);
                updates.currentElo = conservativeElo.toFixed(2);
              }

              await db
                .update(riderDisciplineStats)
                .set(updates)
                .where(eq(riderDisciplineStats.id, existingStats.id));
            } else {
              // Create new stats
              const conservativeElo = Math.max(0, estimatedElo - 3 * eloVariance);
              await db.insert(riderDisciplineStats).values({
                riderId: rider.id,
                discipline,
                ageCategory,
                gender,
                uciPoints: ranking.points,
                uciRank: ranking.rank,
                teamId,
                eloMean: estimatedElo.toFixed(4),
                eloVariance: eloVariance.toFixed(4),
                currentElo: conservativeElo.toFixed(2),
              });
            }
          } catch (riderError) {
            const msg = `Error processing rider ${ranking.name}: ${riderError instanceof Error ? riderError.message : String(riderError)}`;
            console.error(`[sync] ${msg}`);
          }
        }

        const categoryDuration = Date.now() - categoryStart;
        console.log(
          `[sync] ${category}: ${rankings.length} entries, ${categoryRidersCreated} created, ${categoryRidersUpdated} updated (${categoryDuration}ms)`
        );

        result.categoryDetails.push({
          category,
          entries: rankings.length,
          ridersCreated: categoryRidersCreated,
          ridersUpdated: categoryRidersUpdated,
        });

        result.totalEntries += rankings.length;
        result.ridersCreated += categoryRidersCreated;
        result.ridersUpdated += categoryRidersUpdated;
      } catch (categoryError) {
        const msg = `Error processing ${category}: ${categoryError instanceof Error ? categoryError.message : String(categoryError)}`;
        console.error(`[sync] ${msg}`);
        result.errors.push(msg);
      }
    }

    // Zero out UCI points/rank for stats NOT touched during this sync.
    // This ensures riders no longer in the rankings get 0 points.
    const zeroResult = await db
      .update(riderDisciplineStats)
      .set({ uciPoints: 0, uciRank: null })
      .where(
        and(
          eq(riderDisciplineStats.discipline, discipline),
          lt(riderDisciplineStats.updatedAt, syncStartedAt)
        )
      );
    console.log(`[sync] Zeroed UCI points for stats not updated during this sync`);

    result.status = "completed";
  } catch (error) {
    result.status = "failed";
    result.errors.push(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  result.durationMs = Date.now() - startTime;

  // Update sync run record
  await db
    .update(uciSyncRuns)
    .set({
      status: result.status,
      completedAt: new Date(),
      durationMs: result.durationMs,
      totalEntries: result.totalEntries,
      ridersCreated: result.ridersCreated,
      ridersUpdated: result.ridersUpdated,
      teamsCreated: result.teamsCreated,
      errors: result.errors,
      categoryDetails: result.categoryDetails,
    })
    .where(eq(uciSyncRuns.id, syncRun.id));

  console.log(
    `[sync] Complete: ${result.totalEntries} entries, ${result.ridersCreated} created, ${result.ridersUpdated} updated (${result.durationMs}ms)`
  );

  return result;
}
