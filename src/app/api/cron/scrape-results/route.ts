import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, riders } from "@/lib/db";
import { scrapeRaceResults } from "@/lib/scraper/pcs";
import { eq, lt, and } from "drizzle-orm";

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

  const results: Array<{ race: string; status: string; count?: number }> = [];

  try {
    // Find completed races without results
    const today = new Date().toISOString().split("T")[0];
    const racesWithoutResults = await db
      .select()
      .from(races)
      .where(
        and(
          lt(races.date, today),
          eq(races.status, "active")
        )
      )
      .limit(10); // Process 10 races per run to avoid timeout

    for (const race of racesWithoutResults) {
      if (!race.pcsUrl) {
        results.push({
          race: race.name,
          status: "skipped",
        });
        continue;
      }

      try {
        // Scrape results from PCS
        const scrapedResults = await scrapeRaceResults(race.pcsUrl);

        if (scrapedResults.length === 0) {
          results.push({
            race: race.name,
            status: "no_results",
          });
          continue;
        }

        // Insert results into database
        let insertedCount = 0;
        for (const result of scrapedResults) {
          // Find rider in database
          const [rider] = await db
            .select()
            .from(riders)
            .where(eq(riders.pcsId, result.riderPcsId))
            .limit(1);

          if (!rider) continue;

          // Insert result
          await db
            .insert(raceResults)
            .values({
              raceId: race.id,
              riderId: rider.id,
              position: result.position,
              dnf: result.dnf,
              dns: result.dns,
              pointsUci: result.uciPoints,
              pointsPcs: result.pcsPoints,
            })
            .onConflictDoNothing();

          insertedCount++;
        }

        // Mark race as completed
        await db
          .update(races)
          .set({ status: "completed" })
          .where(eq(races.id, race.id));

        results.push({
          race: race.name,
          status: "success",
          count: insertedCount,
        });
      } catch (error) {
        console.error(`Error processing race ${race.name}:`, error);
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
    console.error("Cron scrape-results error:", error);
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
