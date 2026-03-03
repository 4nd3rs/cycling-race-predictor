import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, raceStartlist, raceEvents } from "@/lib/db";
import { and, eq, lt, gte, lte, isNull, exists, notExists, sql, asc } from "drizzle-orm";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";

export const maxDuration = 60;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Check 1: Mark stale races as completed ────────────────────────────────────

async function markStaleRaces(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Active races with date > 7 days ago and NO results → mark completed
  const stale = await db
    .select({ id: races.id, name: races.name })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        lt(races.date, sevenDaysAgo),
        notExists(
          db.select({ id: raceResults.id })
            .from(raceResults)
            .where(eq(raceResults.raceId, races.id))
        )
      )
    );

  if (stale.length > 0) {
    const ids = stale.map(r => r.id);
    await db
      .update(races)
      .set({ status: "completed" })
      .where(sql`${races.id} = ANY(${ids})`);
    console.log(`[doctor] Marked ${stale.length} stale races as completed:`, stale.map(r => r.name));
  }

  return stale.length;
}

// ── Check 2: Mark races with results as completed ─────────────────────────────

async function markRacesWithResults(): Promise<number> {
  const withResults = await db
    .select({ id: races.id, name: races.name })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        exists(
          db.select({ id: raceResults.id })
            .from(raceResults)
            .where(eq(raceResults.raceId, races.id))
        )
      )
    );

  if (withResults.length > 0) {
    const ids = withResults.map(r => r.id);
    await db
      .update(races)
      .set({ status: "completed" })
      .where(sql`${races.id} = ANY(${ids})`);
    console.log(`[doctor] Marked ${withResults.length} races with results as completed:`, withResults.map(r => r.name));
  }

  return withResults.length;
}

// ── Check 3: Backfill PCS URLs ────────────────────────────────────────────────

async function backfillPcsUrls(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Find active road races missing PCS URLs
  const missingPcs = await db
    .select({
      id: races.id,
      name: races.name,
      date: races.date,
      raceEventId: races.raceEventId,
    })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        eq(races.discipline, "road"),
        isNull(races.pcsUrl),
        gte(races.date, today),
        lte(races.date, cutoff)
      )
    )
    .limit(30);

  if (missingPcs.length === 0) return 0;

  // Try to match via event name against PCS calendar
  let pcsRaces: Array<{ name: string; pcsUrl: string }> = [];
  try {
    const html = await scrapeDo("https://www.procyclingstats.com/races.php");
    const $ = cheerio.load(html);
    const currentYear = new Date().getFullYear();

    $("table tbody tr").each((_, row) => {
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      const link = $(row).find("a[href*='/race/']").first();
      const href = link.attr("href") ?? "";
      const name = cells[2] || "";
      if (!name || !href) return;

      const pcsUrl = href.startsWith("http")
        ? href
        : `https://www.procyclingstats.com/${href.replace(/^\//, "")}`;

      pcsRaces.push({ name, pcsUrl });
    });
  } catch (err) {
    console.error("[doctor] PCS calendar scrape error:", err);
    return 0;
  }

  let backfilled = 0;
  for (const race of missingPcs) {
    // Get the event name for better matching
    let eventName = race.name;
    if (race.raceEventId) {
      const [event] = await db
        .select({ name: raceEvents.name })
        .from(raceEvents)
        .where(eq(raceEvents.id, race.raceEventId))
        .limit(1);
      if (event) eventName = event.name;
    }

    const normalize = (s: string) =>
      s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim();

    const normalizedEvent = normalize(eventName);

    const match = pcsRaces.find(p => {
      const normalizedPcs = normalize(p.name);
      return normalizedPcs === normalizedEvent
        || normalizedPcs.includes(normalizedEvent)
        || normalizedEvent.includes(normalizedPcs);
    });

    if (match) {
      await db.update(races).set({ pcsUrl: match.pcsUrl }).where(eq(races.id, race.id));
      backfilled++;
      console.log(`[doctor] Backfilled PCS URL for "${race.name}" → ${match.pcsUrl}`);
    }
  }

  return backfilled;
}

// ── Check 4: Report stats ─────────────────────────────────────────────────────

async function gatherStats() {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const upcoming = await db
    .select({
      id: races.id,
      name: races.name,
      date: races.date,
      pcsUrl: races.pcsUrl,
    })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        gte(races.date, today),
        lte(races.date, cutoff)
      )
    )
    .orderBy(asc(races.date));

  const withStartlist = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        gte(races.date, today),
        lte(races.date, cutoff),
        exists(
          db.select({ id: raceStartlist.id })
            .from(raceStartlist)
            .where(eq(raceStartlist.raceId, races.id))
        )
      )
    );

  return {
    upcomingRaces: upcoming.length,
    withStartlists: withStartlist.length,
    withoutStartlists: upcoming.length - withStartlist.length,
    withPcsUrl: upcoming.filter(r => r.pcsUrl).length,
    withoutPcsUrl: upcoming.filter(r => !r.pcsUrl).length,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const staleFixed = await markStaleRaces();
    const resultsFixed = await markRacesWithResults();
    const pcsBackfilled = await backfillPcsUrls();
    const stats = await gatherStats();

    return NextResponse.json({
      success: true,
      fixes: {
        staleRacesCompleted: staleFixed,
        racesWithResultsCompleted: resultsFixed,
        pcsUrlsBackfilled: pcsBackfilled,
      },
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron/doctor]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
