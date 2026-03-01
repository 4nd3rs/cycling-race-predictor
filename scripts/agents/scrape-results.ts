/**
 * Scrape Results Agent
 *
 * Scrapes race results from ProCyclingStats via scrape.do (bypasses Cloudflare).
 * Handles one-day races, stage races (per-stage + GC), and women's events.
 * Falls back to marking races for LLM fallback if no pcsUrl is available.
 *
 * Usage:
 *   tsx scripts/agents/scrape-results.ts [--race-id <uuid>] [--days <n>] [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";
import { scrapeDo } from "../../src/lib/scraper/scrape-do";
import { writeScrapeStatus, type RaceRow } from "./lib/scrape-status";
import { processRaceElo } from "../../src/lib/prediction/process-race-elo";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const raceIdArg = getArg("race-id", "");
const daysBack = parseInt(getArg("days", "7"), 10);
const dryRun = args.includes("--dry-run");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ParsedResult {
  riderName: string;
  riderPcsId: string;
  teamName: string | null;
  position: number | null;
  timeSeconds: number | null;
  timeGapSeconds: number | null;
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  stage?: number; // set for stage races
}

// ─── Time parsers ─────────────────────────────────────────────────────────────

function parseTimeStr(raw: string): number | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const cleaned = raw.trim().replace(/\s+/g, "");
  // HH:MM:SS or MM:SS or H:MM:SS
  const parts = cleaned.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseGapStr(raw: string): number | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const cleaned = raw.trim().replace(/^[+\s]+/, "");
  return parseTimeStr(cleaned);
}

// ─── PCS results page scraper ─────────────────────────────────────────────────

async function scrapeResultsFromPage(
  url: string,
  stageNum?: number
): Promise<ParsedResult[]> {
  console.log(`   📄 Fetching: ${url}`);
  let html: string;
  try {
    html = await scrapeDo(url, { render: true, timeout: 30000 });
  } catch (err: any) {
    console.error(`   ❌ scrape.do failed: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);

  // Check if PCS shows "no results yet"
  if ($(".page-not-found, .error-404, h1.red").length || $("title").text().toLowerCase().includes("not found")) {
    console.log(`   ⏳ No results page found (race may not have finished)`);
    return [];
  }

  const results: ParsedResult[] = [];
  const table = $("table.results, table[class*='result']").first();

  if (table.length) {
    const headers: string[] = [];
    table.find("thead th, thead td").each((_, th) => headers.push($(th).text().trim().toLowerCase()));
    const rnkIdx = headers.findIndex(h => h === "rnk" || h === "pos" || h === "#");
    const riderIdx = headers.findIndex(h => h.includes("rider") || h === "name");
    const teamIdx = headers.findIndex(h => h.includes("team"));
    const timeIdx = headers.findIndex(h => h === "time");
    const gapIdx = headers.findIndex(h => h === "gap" || h === "+");

    table.find("tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      const posText = cells.eq(rnkIdx >= 0 ? rnkIdx : 0).text().trim();
      const riderLink = $(row).find("a[href*='rider/']").first();
      const riderName = riderLink.text().trim();
      const riderHref = riderLink.attr("href") || "";
      const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";
      if (!riderName || !riderPcsId) return;
      const teamName = $(row).find("a[href*='team/']").text().trim() || null;
      const timeText = timeIdx >= 0 ? cells.eq(timeIdx).text().trim() : "";
      const gapText = gapIdx >= 0 ? cells.eq(gapIdx).text().trim() : "";
      results.push({
        riderName, riderPcsId, teamName,
        pos: posText,
        timeStr: timeText,
        gapStr: gapText,
      });
    });
  }

  const parsed: ParsedResult[] = results
    .map(r => {
      const isDnf = r.pos.toUpperCase() === "DNF";
      const isDns = r.pos.toUpperCase() === "DNS";
      const position = isDnf || isDns ? null : parseInt(r.pos, 10) || null;
      return {
        riderName: r.riderName,
        riderPcsId: r.riderPcsId,
        teamName: r.teamName,
        position,
        dnf: isDnf,
        dns: isDns,
        timeSeconds: parseTimeStr(r.timeStr),
        gapSeconds: parseGapStr(r.gapStr),
        stageNum: stageNum ?? null,
      };
    })
    .filter(r => r.riderName && r.riderPcsId);

  console.log(`   ✅ Parsed ${parsed.length} results from ${url}`);
  return parsed;
}


async function detectStageCount(pcsUrl: string): Promise<number> {
  try {
    const html = await scrapeDo(pcsUrl, { render: true, timeout: 20000 });
    const $ = cheerio.load(html);
    const nums: number[] = [];
    $("a[href*='/stage-']").each((_, el) => {
      const m = ($(el).attr("href") ?? "").match(/\/stage-(\d+)/);
      if (m) nums.push(parseInt(m[1], 10));
    });
    return nums.length > 0 ? Math.max(...nums) : 0;
  } catch {
    return 0;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/).sort().join(" ");
}

async function findOrCreateTeam(name: string): Promise<string> {
  const existing = await db.query.teams.findFirst({
    where: (t, { ilike }) => ilike(t.name, name),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.teams)
    .values({ name, discipline: "road" })
    .returning({ id: schema.teams.id });
  return created.id;
}

async function findOrCreateRider(name: string, pcsId: string): Promise<string> {
  // 1. By pcsId
  if (pcsId) {
    const byPcsId = await db.query.riders.findFirst({
      where: eq(schema.riders.pcsId, pcsId),
    });
    if (byPcsId) return byPcsId.id;
  }
  // 2. Exact name
  const byName = await db.query.riders.findFirst({
    where: (r, { ilike }) => ilike(r.name, name),
  });
  if (byName) {
    if (pcsId) await db.update(schema.riders).set({ pcsId }).where(eq(schema.riders.id, byName.id));
    return byName.id;
  }
  // 3. Accent-stripped
  const allRiders = await db.select({ id: schema.riders.id, name: schema.riders.name })
    .from(schema.riders).limit(8000);
  const stripped = stripAccents(name);
  const match = allRiders.find(r => stripAccents(r.name) === stripped);
  if (match) {
    if (pcsId) await db.update(schema.riders).set({ pcsId }).where(eq(schema.riders.id, match.id));
    return match.id;
  }
  // 4. Word-order-normalised (Mathieu VAN DER POEL = VAN DER POEL Mathieu)
  const norm = normalizeName(name);
  const normMatch = allRiders.find(r => normalizeName(r.name) === norm);
  if (normMatch) {
    if (pcsId) await db.update(schema.riders).set({ pcsId }).where(eq(schema.riders.id, normMatch.id));
    return normMatch.id;
  }
  // 5. Create new
  const [created] = await db
    .insert(schema.riders)
    .values({ name, pcsId: pcsId || undefined })
    .returning({ id: schema.riders.id });
  return created.id;
}

async function importResults(
  raceId: string,
  results: ParsedResult[],
  discipline: string,
  ageCategory: string,
  gender: string
): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0, skipped = 0, errors = 0;

  for (const r of results) {
    try {
      const teamId = r.teamName ? await findOrCreateTeam(r.teamName) : null;
      const riderId = await findOrCreateRider(r.riderName, r.riderPcsId);

      // Check for existing result
      const [existing] = await db
        .select({ id: schema.raceResults.id })
        .from(schema.raceResults)
        .where(and(
          eq(schema.raceResults.raceId, raceId),
          eq(schema.raceResults.riderId, riderId)
        ))
        .limit(1);

      if (existing) { skipped++; continue; }

      await db.insert(schema.raceResults).values({
        raceId,
        riderId,
        teamId: teamId ?? null,
        position: r.position,
        timeSeconds: r.timeSeconds,
        timeGapSeconds: r.timeGapSeconds,
        dnf: r.dnf,
        dns: r.dns,
      });
      inserted++;

      // Ensure rider has discipline stats
      const existingStats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(schema.riderDisciplineStats.riderId, riderId),
          eq(schema.riderDisciplineStats.discipline, discipline),
          eq(schema.riderDisciplineStats.ageCategory, ageCategory)
        ),
      });
      if (!existingStats) {
        await db.insert(schema.riderDisciplineStats).values({
          riderId, discipline, ageCategory, gender,
          currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
        }).onConflictDoNothing();
      }
    } catch (err: any) {
      console.error(`   ❌ ${r.riderName}: ${err.message}`);
      errors++;
    }
  }

  return { inserted, skipped, errors };
}

// ─── Per-race orchestration ────────────────────────────────────────────────────

interface RaceToProcess {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  discipline: string;
  raceType: string | null;
  ageCategory: string;
  gender: string;
  pcsUrl: string | null;
  status: string | null;
}

async function processRace(
  race: RaceToProcess
): Promise<{ inserted: number; status: string }> {

  if (!race.pcsUrl) {
    console.log(`⏭️  ${race.name}: no pcsUrl — needs LLM fallback`);
    return { inserted: 0, status: "no-pcsurl" };
  }

  const isStageRace = race.raceType === "stage_race" || race.endDate !== null;
  let allResults: ParsedResult[] = [];

  if (isStageRace) {
    const stageCount = await detectStageCount(race.pcsUrl);
    console.log(`   Stage race: ${stageCount} stages detected`);

    if (stageCount > 0) {
      const today = new Date().toISOString().split("T")[0];
      const raceEnd = race.endDate ?? race.date;
      const isFinished = today > raceEnd;

      if (isFinished) {
        const gcResults = await scrapeResultsFromPage(`${race.pcsUrl}/gc`);
        if (gcResults.length > 0) allResults = gcResults;
        else allResults = await scrapeResultsFromPage(`${race.pcsUrl}/stage-${stageCount}/result`);
      } else {
        for (let s = stageCount; s >= 1; s--) {
          const stageResults = await scrapeResultsFromPage(`${race.pcsUrl}/stage-${s}/result`, s);
          if (stageResults.length > 0) { allResults = stageResults; break; }
        }
      }
    } else {
      const res = await scrapeResultsFromPage(`${race.pcsUrl}/result`);
      if (res.length > 0) allResults = res;
      else allResults = await scrapeResultsFromPage(`${race.pcsUrl}/gc`);
    }
  } else {
    allResults = await scrapeResultsFromPage(`${race.pcsUrl}/result`);
  }

  if (allResults.length === 0) {
    return { inserted: 0, status: "no-results-yet" };
  }

  if (dryRun) {
    console.log(`   🔍 [dry-run] Would import ${allResults.length} results`);
    return { inserted: allResults.length, status: "dry-run" };
  }

  const { inserted, skipped, errors } = await importResults(
    race.id,
    allResults,
    race.discipline,
    race.ageCategory,
    race.gender
  );

  if (inserted > 0) {
    // Mark race completed
    await db.update(schema.races)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(schema.races.id, race.id));

    // Trigger ELO update
    try {
      const eloUpdates = await processRaceElo(race.id);
      console.log(`   🎯 ELO: ${eloUpdates} rider ratings updated`);
    } catch (err: any) {
      console.warn(`   ⚠️  ELO update failed: ${err.message}`);
    }
  }

  console.log(`   ✅ ${inserted} inserted, ${skipped} already existed, ${errors} errors`);
  return {
    inserted,
    status: inserted > 0 ? "imported" : skipped > 0 ? "already-done" : "error",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏁 PCS Results Scraper${dryRun ? " [DRY RUN]" : ""}`);
  console.log(`─────────────────────────────`);

  const today = new Date().toISOString().split("T")[0];
  const pastDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];

  // Query races that need results
  let races: RaceToProcess[];

  if (raceIdArg) {
    const r = await db.query.races.findFirst({ where: eq(schema.races.id, raceIdArg) });
    races = r ? [{
      id: r.id,
      name: r.name,
      date: r.date,
      endDate: r.endDate ?? null,
      discipline: r.discipline,
      raceType: r.raceType ?? null,
      ageCategory: r.ageCategory ?? "elite",
      gender: r.gender ?? "men",
      pcsUrl: r.pcsUrl ?? null,
      status: r.status ?? null,
    }] : [];
  } else {
    // Races in the past N days OR today that are NOT completed and have pcsUrl
    const rows = await db
      .select({
        id: schema.races.id,
        name: schema.races.name,
        date: schema.races.date,
        endDate: schema.races.endDate,
        discipline: schema.races.discipline,
        raceType: schema.races.raceType,
        ageCategory: schema.races.ageCategory,
        gender: schema.races.gender,
        pcsUrl: schema.races.pcsUrl,
        status: schema.races.status,
      })
      .from(schema.races)
      .where(and(
        gte(schema.races.date, pastDate),
        lte(schema.races.date, today),
        sql`${schema.races.status} != 'completed'`,
      ))
      .orderBy(schema.races.date);

    races = rows.map(r => ({
      ...r,
      endDate: r.endDate ?? null,
      raceType: r.raceType ?? null,
      ageCategory: r.ageCategory ?? "elite",
      gender: r.gender ?? "men",
      pcsUrl: r.pcsUrl ?? null,
      status: r.status ?? null,
    }));
  }

  if (races.length === 0) {
    console.log("No races needing results.");
    writeScrapeStatus({
      component: "results",
      status: "ok",
      summary: "No races needing results",
    });
    return;
  }

  // Separate PCS-able from non-PCS races
  const withPcs = races.filter(r => r.pcsUrl);
  const noPcs = races.filter(r => !r.pcsUrl);

  console.log(`Found ${races.length} race(s) needing results (${withPcs.length} with PCS URL, ${noPcs.length} without)\n`);
  races.forEach(r => console.log(`  • ${r.name} (${r.date})${r.pcsUrl ? "" : " — no pcsUrl"}`));
  console.log();

  const raceRows: import("./lib/scrape-status").RaceRow[] = [];
  let totalInserted = 0;
  let totalNoResults = 0;

  try {
    for (const race of races) {
      console.log(`\n🔍 ${race.name} (${race.date})`);
      const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
      const { inserted, status } = await processRace(race);
      totalInserted += inserted;
      if (status === "no-results-yet" || status === "no-pcsurl") totalNoResults++;

      const statusEmoji =
        status === "imported" ? "✅ imported" :
        status === "already-done" ? "✅ already done" :
        status === "no-results-yet" ? "⏳ pending" :
        status === "no-pcsurl" ? "⏭️ no pcsUrl" :
        status === "dry-run" ? "🔍 dry-run" :
        "❌ error";

      raceRows.push({
        name: race.name,
        date: race.date,
        count: inserted,
        status: statusEmoji,
        scrapedAt: now,
      });
    }
  } finally {
    // no browser to close
  }

  // Write status
  const overallStatus = totalInserted > 0 ? "ok" : totalNoResults === races.length ? "ok" : "warn";
  writeScrapeStatus({
    component: "results",
    status: overallStatus,
    summary: `${totalInserted} results imported across ${races.length} race(s). ${noPcs.length} race(s) need LLM fallback (no pcsUrl).`,
    raceRows,
  });

  console.log(`\n─────────────────────────────`);
  console.log(`Total: ${totalInserted} results imported`);
  if (noPcs.length > 0) {
    console.log(`\n⚠️  ${noPcs.length} race(s) have no pcsUrl — LLM fallback needed:`);
    noPcs.forEach(r => console.log(`   • ${r.name} (${r.date})`));
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
