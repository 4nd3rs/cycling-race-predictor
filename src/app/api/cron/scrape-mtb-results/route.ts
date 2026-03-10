/**
 * /api/cron/scrape-mtb-results
 * Scrapes MTB XCO results from timing platforms (sportstiming, raceresult, eqtiming).
 * Runs every 6h. Covers last 7 days of races.
 */

import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { db, races, raceResults, raceEvents, riderDisciplineStats } from "@/lib/db";
import { and, eq, gte, lte, or, isNull, ne } from "drizzle-orm";
import { findOrCreateRider } from "@/lib/riders/find-or-create";
import { processRaceElo } from "@/lib/prediction/process-race-elo";
import {
  scrapeResults,
  classifyCategory,
  type TimingSystem,
  SUPPORTED_TIMING_SYSTEMS,
} from "@/lib/scraper/timing-adapters";
import { postToDiscord } from "@/lib/discord";

export const maxDuration = 300;

const DAYS_BACK = 7;

// ── Main handler ───────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const pastDate = new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10);

  try {
    // Find pending MTB races that have a timing system via their raceEvent
    const pendingRaces = await db
      .select({
        id: races.id,
        name: races.name,
        date: races.date,
        ageCategory: races.ageCategory,
        gender: races.gender,
        raceType: races.raceType,
        raceEventId: races.raceEventId,
        timingSystem: raceEvents.timingSystem,
        timingEventId: raceEvents.timingEventId,
      })
      .from(races)
      .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(
        eq(races.discipline, "mtb"),
        gte(races.date, pastDate),
        lte(races.date, today),
        or(isNull(races.status), ne(races.status, "completed")),
      ));

    if (pendingRaces.length === 0) {
      return NextResponse.json({ success: true, message: "No pending MTB races", timestamp: new Date().toISOString() });
    }

    // Group races by raceEvent to avoid scraping the same timing event multiple times
    const resultsByEvent = new Map<string, Awaited<ReturnType<typeof scrapeResults>>>();
    let totalInserted = 0;
    const report: string[] = [];

    for (const race of pendingRaces) {
      const timingSystem = race.timingSystem as TimingSystem | null;
      const timingEventId = race.timingEventId;

      if (!timingSystem || !timingEventId || !SUPPORTED_TIMING_SYSTEMS.includes(timingSystem)) {
        report.push(`⏭️ ${race.name} — no timing system`);
        continue;
      }

      // Fetch results (cached per event)
      const cacheKey = `${timingSystem}:${timingEventId}`;
      let allResults = resultsByEvent.get(cacheKey);
      if (!allResults) {
        try {
          allResults = await scrapeResults(timingSystem, timingEventId);
          resultsByEvent.set(cacheKey, allResults);
        } catch (e: any) {
          report.push(`❌ ${race.name} — ${e.message}`);
          continue;
        }
      }

      if (!allResults.length) {
        report.push(`⏳ ${race.name} — no results yet`);
        continue;
      }

      // Filter results to this race's category
      const ageCategory = race.ageCategory ?? "elite";
      const gender = race.gender ?? "men";
      const catResults = allResults.filter(r => {
        const match = classifyCategory(r.categoryName);
        return match && match.ageCategory === ageCategory && match.gender === gender;
      });

      // Fallback: if only one category in results and no match, use all
      const uniqueCats = new Set(allResults.map(r => r.categoryName));
      const toImport = catResults.length > 0 ? catResults : (uniqueCats.size === 1 ? allResults : []);

      if (!toImport.length || toImport.filter(r => !r.dnf && !r.dns).length < 3) {
        // If U23 race has no matching results, check if elite race is already completed
        // (timing platforms often combine U23+Elite into one category)
        if (ageCategory === "u23" && catResults.length === 0 && race.raceEventId) {
          const [eliteSibling] = await db.select({ status: races.status }).from(races).where(and(
            eq(races.raceEventId, race.raceEventId),
            eq(races.ageCategory, "elite"),
            eq(races.gender, gender),
          )).limit(1);
          if (eliteSibling?.status === "completed") {
            report.push(`⏭️ ${race.name} — U23 merged with elite`);
            continue;
          }
        }
        report.push(`⏳ ${race.name} — incomplete results`);
        continue;
      }

      // Import results
      const existing = new Set(
        (await db.select({ riderId: raceResults.riderId }).from(raceResults).where(eq(raceResults.raceId, race.id))).map(r => r.riderId)
      );
      let inserted = 0;

      for (const r of toImport) {
        const { id: riderId } = await findOrCreateRider({ name: r.riderName });
        if (existing.has(riderId)) continue;
        await db.insert(raceResults).values({
          raceId: race.id,
          riderId,
          position: r.position,
          timeSeconds: r.timeSeconds,
          dnf: r.dnf,
          dns: r.dns,
        });
        await db.insert(riderDisciplineStats).values({
          riderId,
          discipline: "mtb",
          ageCategory,
          gender,
          eloMean: "1500",
          eloVariance: "350",
        }).onConflictDoNothing();
        existing.add(riderId);
        inserted++;
      }

      if (inserted > 0) {
        await db.update(races).set({ status: "completed", updatedAt: new Date() }).where(eq(races.id, race.id));
        try { await processRaceElo(race.id); } catch {}
        totalInserted += inserted;
        report.push(`✅ ${race.name} — ${inserted} results`);
      } else {
        report.push(`✅ ${race.name} — already imported`);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    if (totalInserted > 0) {
      const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
      await postToDiscord(`🚵 MTB Results [${time}] — ${totalInserted} new results\n${report.slice(0, 5).map(r => `• ${r}`).join("\n")}`);
    }

    return NextResponse.json({ success: true, totalInserted, races: report, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/scrape-mtb-results]", error);
    await postToDiscord(`🚵 MTB Results ⚠️ Error: ${String(error).substring(0, 200)}`);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() { return GET(); }
