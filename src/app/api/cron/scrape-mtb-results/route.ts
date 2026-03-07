/**
 * /api/cron/scrape-mtb-results
 * Scrapes MTB XCO results from timing platforms (sportstiming, raceresult, eqtiming).
 * Runs every 6h. Covers last 7 days of races.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, raceEvents, riderDisciplineStats } from "@/lib/db";
import { riders } from "@/lib/db/schema";
import { and, eq, gte, lte, or, isNull, ne } from "drizzle-orm";
import { processRaceElo } from "@/lib/prediction/process-race-elo";
import {
  scrapeResults,
  classifyCategory,
  type TimingSystem,
  SUPPORTED_TIMING_SYSTEMS,
} from "@/lib/scraper/timing-adapters";

export const maxDuration = 300;

const DISCORD_CHANNEL = "1476643255243509912";
const DAYS_BACK = 7;

// ── Auth & Discord ─────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

async function postToDiscord(msg: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });
  } catch {}
}

// ── Rider cache & import ──────────────────────────────────────────────────────

let riderCache: Map<string, string> | null = null;

async function getRiderCache(): Promise<Map<string, string>> {
  if (riderCache) return riderCache;
  const all = await db.select({ id: riders.id, name: riders.name }).from(riders).limit(20000);
  riderCache = new Map();
  for (const r of all) {
    const stripped = r.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const norm = stripped.replace(/[^a-z\s]/g, "").trim().split(/\s+/).sort().join(" ");
    riderCache.set(`name:${stripped}`, r.id);
    riderCache.set(`norm:${norm}`, r.id);
  }
  return riderCache;
}

async function findOrCreateRider(name: string): Promise<string> {
  const cache = await getRiderCache();
  const stripped = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (cache.has(`name:${stripped}`)) return cache.get(`name:${stripped}`)!;
  const norm = stripped.replace(/[^a-z\s]/g, "").trim().split(/\s+/).sort().join(" ");
  if (cache.has(`norm:${norm}`)) return cache.get(`norm:${norm}`)!;
  const [created] = await db.insert(riders).values({ name }).returning({ id: riders.id });
  cache.set(`name:${stripped}`, created.id);
  cache.set(`norm:${norm}`, created.id);
  return created.id;
}

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
        report.push(`⏳ ${race.name} — incomplete results`);
        continue;
      }

      // Import results
      const existing = new Set(
        (await db.select({ riderId: raceResults.riderId }).from(raceResults).where(eq(raceResults.raceId, race.id))).map(r => r.riderId)
      );
      let inserted = 0;

      for (const r of toImport) {
        const riderId = await findOrCreateRider(r.riderName);
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
