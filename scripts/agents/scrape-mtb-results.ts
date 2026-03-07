/**
 * MTB Results Scraper
 *
 * Scrapes XCO/XCC race results from timing platforms (sportstiming, raceresult, eqtiming).
 * For MTB discipline races that have a timing system configured on their raceEvent.
 *
 * Usage:
 *   tsx scripts/agents/scrape-mtb-results.ts [--race-id <uuid>] [--days <n>] [--dry-run] [--force]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, or, isNull, ne, inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { spawn } from "child_process";
import { processRaceElo } from "../../src/lib/prediction/process-race-elo";
import { writeScrapeStatus, type RaceRow } from "./lib/scrape-status";
import {
  scrapeResults,
  classifyCategory,
  type TimingSystem,
  SUPPORTED_TIMING_SYSTEMS,
} from "../../src/lib/scraper/timing-adapters";

function fireAndForget(cmd: string, args: string[]): void {
  const child = spawn("node_modules/.bin/tsx", [cmd, ...args], {
    cwd: process.cwd(), stdio: "ignore", detached: true,
  });
  child.unref();
}

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const raceIdArg = getArg("race-id", "");
const daysBack = parseInt(getArg("days", "14"), 10);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── DB helpers ────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim().split(/\s+/).sort().join(" ");
}

let riderCache: Map<string, string> | null = null;

async function getRiderCache(): Promise<Map<string, string>> {
  if (riderCache) return riderCache;
  const all = await db.select({ id: schema.riders.id, name: schema.riders.name, pcsId: schema.riders.pcsId })
    .from(schema.riders).limit(20000);
  riderCache = new Map();
  for (const r of all) {
    if (r.pcsId) riderCache.set(`pcs:${r.pcsId}`, r.id);
    riderCache.set(`name:${stripAccents(r.name)}`, r.id);
    riderCache.set(`norm:${normalizeName(r.name)}`, r.id);
  }
  return riderCache;
}

async function findOrCreateRider(name: string): Promise<string> {
  const cache = await getRiderCache();
  const stripped = stripAccents(name);
  if (cache.has(`name:${stripped}`)) return cache.get(`name:${stripped}`)!;
  const norm = normalizeName(name);
  if (cache.has(`norm:${norm}`)) return cache.get(`norm:${norm}`)!;
  const [created] = await db.insert(schema.riders).values({ name }).returning({ id: schema.riders.id });
  cache.set(`name:${stripped}`, created.id);
  cache.set(`norm:${norm}`, created.id);
  return created.id;
}

// ─── Result import ─────────────────────────────────────────────────────────────

interface ImportResult { inserted: number; skipped: number; errors: number }

async function importResults(
  raceId: string,
  results: Awaited<ReturnType<typeof scrapeResults>>,
  ageCategory: string,
  gender: string,
): Promise<ImportResult> {
  let inserted = 0, skipped = 0, errors = 0;

  const existing = await db.select({ riderId: schema.raceResults.riderId })
    .from(schema.raceResults).where(eq(schema.raceResults.raceId, raceId));
  const existingIds = new Set(existing.map(r => r.riderId));

  for (const r of results) {
    try {
      const riderId = await findOrCreateRider(r.riderName);
      if (existingIds.has(riderId)) { skipped++; continue; }
      await db.insert(schema.raceResults).values({
        raceId, riderId,
        position: r.position,
        timeSeconds: r.timeSeconds,
        dnf: r.dnf,
        dns: r.dns,
        dsq: false,
      });
      existingIds.add(riderId);
      inserted++;
      const higherCategories =
        ageCategory === "junior" ? ["u23", "elite"] :
        ageCategory === "u23"    ? ["elite"] : [];
      const hasHigherRow = higherCategories.length > 0
        ? !!(await db.query.riderDisciplineStats.findFirst({
            where: and(
              eq(schema.riderDisciplineStats.riderId, riderId),
              eq(schema.riderDisciplineStats.discipline, "mtb"),
              eq(schema.riderDisciplineStats.gender, gender),
              inArray(schema.riderDisciplineStats.ageCategory, higherCategories),
            ),
          }))
        : false;
      if (!hasHigherRow) {
        await db.insert(schema.riderDisciplineStats).values({
          riderId, discipline: "mtb", ageCategory, gender,
          currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
        }).onConflictDoNothing();
      }
    } catch (e: any) {
      console.error(`   ❌ ${r.riderName}: ${e.message}`);
      errors++;
    }
  }
  return { inserted, skipped, errors };
}

// ─── Per-race orchestration ────────────────────────────────────────────────────

interface DBRace {
  id: string;
  name: string;
  date: string;
  ageCategory: string;
  gender: string;
  raceType: string | null;
  status: string | null;
  timingSystem: string | null;
  timingEventId: string | null;
}

// Cache scraped results per timing event to avoid re-fetching for each category
const resultsCache = new Map<string, Awaited<ReturnType<typeof scrapeResults>>>();

async function processRace(race: DBRace): Promise<{ inserted: number; status: string }> {
  const timingSystem = race.timingSystem as TimingSystem | null;
  const timingEventId = race.timingEventId;

  if (!timingSystem || !timingEventId || !SUPPORTED_TIMING_SYSTEMS.includes(timingSystem)) {
    console.log(`   ⏭️  No supported timing system (${race.timingSystem ?? "none"})`);
    return { inserted: 0, status: "no-timing" };
  }

  // Fetch results (cached per timing event)
  const cacheKey = `${timingSystem}:${timingEventId}`;
  let allResults = resultsCache.get(cacheKey);
  if (!allResults) {
    console.log(`   📄 Fetching from ${timingSystem} event ${timingEventId}...`);
    allResults = await scrapeResults(timingSystem, timingEventId);
    resultsCache.set(cacheKey, allResults);
  } else {
    console.log(`   📄 Using cached results for ${timingSystem}:${timingEventId}`);
  }

  if (allResults.length === 0) {
    return { inserted: 0, status: "no-results-yet" };
  }

  // Filter to this race's category
  const catResults = allResults.filter(r => {
    const match = classifyCategory(r.categoryName);
    return match && match.ageCategory === race.ageCategory && match.gender === race.gender;
  });

  if (catResults.length === 0) {
    const uniqueCats = [...new Set(allResults.map(r => r.categoryName))];
    console.log(`   ⚠️  No results for ${race.ageCategory} ${race.gender}. Available: ${uniqueCats.join(", ")}`);
    // Fallback: if only one category, use all
    if (uniqueCats.length !== 1) {
      return { inserted: 0, status: "no-cat-match" };
    }
  }

  const toImport = catResults.length > 0 ? catResults : allResults;
  const finishers = toImport.filter(r => !r.dnf && !r.dns).length;

  if (finishers < 3) {
    console.warn(`   ⚠️  Only ${finishers} finishers — skipping (incomplete)`);
    return { inserted: 0, status: "incomplete" };
  }

  if (dryRun) {
    console.log(`   🔍 [dry-run] Would import ${toImport.length} results (${finishers} finishers)`);
    return { inserted: toImport.length, status: "dry-run" };
  }

  const { inserted, skipped, errors } = await importResults(race.id, toImport, race.ageCategory, race.gender);

  if (inserted > 0) {
    await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, race.id));
    try {
      const eloUpdates = await processRaceElo(race.id);
      console.log(`   🎯 ELO: ${eloUpdates} rider ratings updated`);
    } catch (e: any) {
      console.warn(`   ⚠️  ELO update failed: ${e.message}`);
    }

    if (!dryRun) {
      fireAndForget("scripts/agents/generate-predictions.ts", ["--discipline", "mtb", "--days", "30"]);
      console.log(`   🔮 Predictions refresh queued for MTB`);
      fireAndForget("scripts/agents/marketing-agent.ts", []);
      console.log(`   📣 Marketing agent queued`);
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
  console.log(`\n🚵 MTB Results Scraper${dryRun ? " [DRY RUN]" : ""}${force ? " [FORCE]" : ""}`);
  console.log("─────────────────────────────");

  const today = new Date().toISOString().split("T")[0];
  const pastDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];

  let raceRows: Array<DBRace>;

  if (raceIdArg) {
    const r = await db.query.races.findFirst({ where: eq(schema.races.id, raceIdArg) });
    if (!r || r.discipline !== "mtb") { console.log("Race not found or not MTB"); return; }
    // Look up the timing info from the raceEvent
    let timingSystem: string | null = null;
    let timingEventId: string | null = null;
    if (r.raceEventId) {
      const event = await db.query.raceEvents.findFirst({ where: eq(schema.raceEvents.id, r.raceEventId) });
      if (event) {
        timingSystem = event.timingSystem ?? null;
        timingEventId = event.timingEventId ?? null;
      }
    }
    raceRows = [{
      id: r.id, name: r.name, date: r.date,
      ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men",
      raceType: r.raceType ?? null, status: r.status ?? null,
      timingSystem, timingEventId,
    }];
  } else {
    const notCompleted = or(isNull(schema.races.status), ne(schema.races.status, "completed"));
    const statusFilter = force ? undefined : notCompleted;
    const rows = await db.select({
      id: schema.races.id, name: schema.races.name, date: schema.races.date,
      ageCategory: schema.races.ageCategory, gender: schema.races.gender,
      raceType: schema.races.raceType, status: schema.races.status,
      timingSystem: schema.raceEvents.timingSystem,
      timingEventId: schema.raceEvents.timingEventId,
    })
    .from(schema.races)
    .leftJoin(schema.raceEvents, eq(schema.races.raceEventId, schema.raceEvents.id))
    .where(and(
      eq(schema.races.discipline, "mtb"),
      gte(schema.races.date, pastDate),
      lte(schema.races.date, today),
      ...(statusFilter ? [statusFilter] : []),
    ));
    raceRows = rows.map(r => ({
      ...r, ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men",
      raceType: r.raceType ?? null, status: r.status ?? null,
      timingSystem: r.timingSystem ?? null, timingEventId: r.timingEventId ?? null,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  if (raceRows.length === 0) {
    console.log("No MTB races needing results.");
    return;
  }

  console.log(`Found ${raceRows.length} MTB race(s)\n`);
  raceRows.forEach(r => console.log(`  • ${r.name} (${r.date}) [${r.timingSystem ?? "no timing"}]`));
  console.log();

  const statusRows: RaceRow[] = [];
  let totalInserted = 0;

  for (const race of raceRows) {
    console.log(`\n🔍 ${race.name} (${race.date})`);
    const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
    const { inserted, status } = await processRace(race);
    totalInserted += inserted;

    const statusEmoji =
      status === "imported" ? "✅ imported" :
      status === "already-done" ? "✅ already done" :
      status === "no-results-yet" ? "⏳ pending" :
      status === "no-timing" ? "⚠️ no timing system" :
      status === "no-cat-match" ? "⚠️ category mismatch" :
      status === "incomplete" ? "⚠️ incomplete" :
      status === "dry-run" ? "🔍 dry-run" : "❌ error";

    statusRows.push({ name: race.name, date: race.date, count: inserted, status: statusEmoji, scrapedAt: now });
    if (raceRows.indexOf(race) < raceRows.length - 1) await sleep(2000);
  }

  writeScrapeStatus({
    component: "mtb-results" as any,
    status: totalInserted > 0 ? "ok" : "warn",
    summary: `${totalInserted} MTB results imported across ${raceRows.length} race(s).`,
    raceRows: statusRows,
  });

  console.log("\n─────────────────────────────");
  console.log(`Total: ${totalInserted} MTB results imported`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
