import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, riders } from "@/lib/db";
import { scrapeRaceResults } from "@/lib/scraper/pcs";
import { eq, lte, gte, and, desc } from "drizzle-orm";

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET() {
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ race: string; status: string; count?: number }> = [];

  try {
    const today = new Date().toISOString().split("T")[0];
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const racesWithoutResults = await db
      .select()
      .from(races)
      .where(and(lte(races.date, today), gte(races.date, cutoff), eq(races.status, "active")))
      .orderBy(desc(races.date))
      .limit(20);

    for (const race of racesWithoutResults) {
      if (!race.pcsUrl) {
        results.push({ race: race.name, status: "skipped_no_pcs_url" });
        continue;
      }
      try {
        const scrapedResults = await scrapeRaceResults(race.pcsUrl);
        if (scrapedResults.length === 0) {
          results.push({ race: race.name, status: "no_results_found" });
          continue;
        }
        let insertedCount = 0;
        for (const result of scrapedResults) {
          const [rider] = await db.select().from(riders).where(eq(riders.pcsId, result.riderPcsId)).limit(1);
          if (!rider) continue;
          await db.insert(raceResults).values({ raceId: race.id, riderId: rider.id, position: result.position, dnf: result.dnf, dns: result.dns, pointsUci: result.uciPoints, pointsPcs: result.pcsPoints }).onConflictDoNothing();
          insertedCount++;
        }
        if (insertedCount > 0) {
          await db.update(races).set({ status: "completed" }).where(eq(races.id, race.id));
        }
        results.push({ race: race.name, status: insertedCount > 0 ? "success" : "no_riders_matched", count: insertedCount });
      } catch (error) {
        console.error(`Error processing race ${race.name}:`, error);
        results.push({ race: race.name, status: "error" });
      }
    }
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    console.error("Cron scrape-results error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() { return GET(); }
