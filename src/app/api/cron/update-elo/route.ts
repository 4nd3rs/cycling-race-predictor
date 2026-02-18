import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, eloHistory } from "@/lib/db";
import { eq, and, notExists } from "drizzle-orm";
import { processRaceElo } from "@/lib/prediction/process-race-elo";

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
        const updates = await processRaceElo(race.id);

        if (updates === null) {
          results.push({
            race: race.name,
            status: "skipped",
          });
        } else {
          results.push({
            race: race.name,
            status: "success",
            updates,
          });
        }
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
