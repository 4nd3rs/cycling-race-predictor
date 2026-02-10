import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  raceResults,
  riders,
  riderDisciplineStats,
  eloHistory,
} from "@/lib/db";
import {
  processRace,
  calculateElo,
  createInitialSkill,
  type RiderSkill,
  type RaceResult,
} from "@/lib/prediction";
import { eq, and, notExists, sql } from "drizzle-orm";

// Vercel cron jobs are authenticated via CRON_SECRET header
async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  // In development, allow without auth
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // Verify Vercel's cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("CRON_SECRET not set");
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET() {
  // Verify cron authentication
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    race: string;
    status: string;
    updates?: number;
  }> = [];

  try {
    // Find completed races that haven't had ELO processed yet
    const completedRaces = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.status, "completed"),
          notExists(
            db.select({ id: eloHistory.id })
              .from(eloHistory)
              .where(eq(eloHistory.raceId, races.id))
          )
        )
      )
      .orderBy(races.date)
      .limit(20);

    for (const race of completedRaces) {

      try {
        // Get race results
        const raceResultsData = await db
          .select({
            result: raceResults,
            rider: riders,
          })
          .from(raceResults)
          .innerJoin(riders, eq(raceResults.riderId, riders.id))
          .where(eq(raceResults.raceId, race.id));

        if (raceResultsData.length < 2) {
          results.push({
            race: race.name,
            status: "insufficient_data",
          });
          continue;
        }

        // Build skills map from current ELO
        const skillsMap = new Map<string, RiderSkill>();

        for (const { rider } of raceResultsData) {
          // Get current stats for this discipline
          const [stats] = await db
            .select()
            .from(riderDisciplineStats)
            .where(
              and(
                eq(riderDisciplineStats.riderId, rider.id),
                eq(riderDisciplineStats.discipline, race.discipline)
              )
            )
            .limit(1);

          if (stats) {
            skillsMap.set(rider.id, {
              riderId: rider.id,
              mean: parseFloat(stats.eloMean || "1500"),
              variance: parseFloat(stats.eloVariance || "350") ** 2,
            });
          } else {
            // Create initial stats if none exist
            const initialSkill = createInitialSkill(rider.id);
            skillsMap.set(rider.id, initialSkill);

            await db.insert(riderDisciplineStats).values({
              riderId: rider.id,
              discipline: race.discipline,
              ageCategory: race.ageCategory || "elite",
              currentElo: "1500",
              eloMean: "1500",
              eloVariance: "350",
            });
          }
        }

        // Format results for processing
        const raceResultsForElo: RaceResult[] = raceResultsData
          .filter(({ result }) => result.position !== null && !result.dns)
          .map(({ result, rider }) => ({
            riderId: rider.id,
            position: result.position!,
            dnf: result.dnf || false,
          }));

        // Process race and update ELO
        const updates = processRace(raceResultsForElo, skillsMap);

        // Save updates to database
        for (const update of updates) {
          const newElo = calculateElo(update.newMean, update.newVariance);
          const oldElo = calculateElo(update.oldMean, update.oldVariance);

          // Update rider stats
          await db
            .update(riderDisciplineStats)
            .set({
              currentElo: newElo.toString(),
              eloMean: update.newMean.toString(),
              eloVariance: Math.sqrt(update.newVariance).toString(),
              racesTotal: riderDisciplineStats.racesTotal,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(riderDisciplineStats.riderId, update.riderId),
                eq(riderDisciplineStats.discipline, race.discipline)
              )
            );

          // Update win/podium counts
          const riderResult = raceResultsData.find(
            (r) => r.rider.id === update.riderId
          );
          if (riderResult?.result.position) {
            const pos = riderResult.result.position;
            await db.execute(
              `UPDATE rider_discipline_stats
               SET wins_total = wins_total + ${pos === 1 ? 1 : 0},
                   podiums_total = podiums_total + ${pos <= 3 ? 1 : 0},
                   races_total = races_total + 1
               WHERE rider_id = '${update.riderId}'
                 AND discipline = '${race.discipline}'`
            );
          }

          // Record ELO history
          await db.insert(eloHistory).values({
            riderId: update.riderId,
            raceId: race.id,
            discipline: race.discipline,
            ageCategory: race.ageCategory || "elite",
            eloBefore: oldElo.toString(),
            eloAfter: newElo.toString(),
            eloChange: update.eloChange.toString(),
            racePosition: riderResult?.result.position,
          });
        }

        results.push({
          race: race.name,
          status: "success",
          updates: updates.length,
        });
      } catch (error) {
        console.error(`Error processing ELO for race ${race.name}:`, error);
        results.push({
          race: race.name,
          status: "error",
        });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("Cron update-elo error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Support POST for manual triggers
export async function POST() {
  return GET();
}
