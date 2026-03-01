/**
 * Scrape Results Agent
 *
 * Scrapes race results from ProCyclingStats via Playwright (bypasses Cloudflare).
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
import { chromium, type Browser, type Page } from "playwright";
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
  page: Page,
  url: string,
  stageNum?: number
): Promise<ParsedResult[]> {
  console.log(`   📄 Fetching: ${url}`);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
  } catch (err: any) {
    console.error(`   ❌ Navigation failed: ${err.message}`);
    return [];
  }

  // Check if PCS shows "no results yet" or 404
  const pageTitle = await page.title().catch(() => "");
  const notFound = await page.$(".page-not-found, .error-404, h1.red").catch(() => null);
  if (notFound || pageTitle.toLowerCase().includes("not found")) {
    console.log(`   ⏳ No results page found (race may not have finished)`);
    return [];
  }

  // PCS results are in a table with class "results" or in .resultlistbase ul
  const results = await page.evaluate((stageN) => {
    const entries: {
      riderName: string; riderPcsId: string; teamName: string | null;
      pos: string; timeStr: string; gapStr: string;
    }[] = [];

    // ── Method 1: Standard PCS results table ──
    // Columns: rnk | bib | rider | team | ... | time | gap | ...
    const table = document.querySelector("table.results, table[class*='result']") as HTMLTableElement | null;
    if (table) {
      const headers = Array.from(table.querySelectorAll("thead th, thead td"))
        .map(th => th.textContent?.trim().toLowerCase() ?? "");
      const rnkIdx = headers.findIndex(h => h === "rnk" || h === "pos" || h === "#");
      const riderIdx = headers.findIndex(h => h.includes("rider") || h === "name");
      const teamIdx = headers.findIndex(h => h.includes("team"));
      const timeIdx = headers.findIndex(h => h === "time" || h === "finish");
      const gapIdx = headers.findIndex(h => h === "gap" || h === "+");

      table.querySelectorAll("tbody tr").forEach(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 3) return;

        const riderLink = tr.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
        const teamLink = tr.querySelector("a[href*='team/']") as HTMLAnchorElement | null;

        const riderName = riderLink?.textContent?.trim() ?? tds[riderIdx > 0 ? riderIdx : 2]?.textContent?.trim() ?? "";
        const riderHref = riderLink?.getAttribute("href") ?? "";
        const riderPcsId = riderHref.replace(/^\//, "").split("rider/")[1]?.split("/")[0]?.split("?")[0] ?? "";

        const teamName = teamLink?.textContent?.trim() ?? null;
        const posText = tds[rnkIdx > 0 ? rnkIdx : 0]?.textContent?.trim() ?? "";
        const timeText = timeIdx > 0 ? (tds[timeIdx]?.textContent?.trim() ?? "") : "";
        const gapText = gapIdx > 0 ? (tds[gapIdx]?.textContent?.trim() ?? "") : "";

        if (riderName && riderPcsId) {
          entries.push({ riderName, riderPcsId, teamName, pos: posText, timeStr: timeText, gapStr: gapText });
        }
      });
    }

    // ── Method 2: PCS resultlistbase ul (older layout) ──
    if (entries.length === 0) {
      document.querySelectorAll(".resultlistbase > li, ul.list.moblist.finishlist > li").forEach(li => {
        const riderLink = li.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
        const teamLink = li.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
        if (!riderLink) return;

        const riderName = riderLink.textContent?.trim() ?? "";
        const riderHref = riderLink.getAttribute("href") ?? "";
        const riderPcsId = riderHref.replace(/^\//, "").split("rider/")[1]?.split("/")[0] ?? "";
        const teamName = teamLink?.textContent?.trim() ?? null;

        const rnkEl = li.querySelector(".rnk, .pos, [class*='rank']");
        const posText = rnkEl?.textContent?.trim() ?? "";
        const timeEl = li.querySelector(".time, [class*='time']");
        const timeText = timeEl?.textContent?.trim() ?? "";

        if (riderName && riderPcsId) {
          entries.push({ riderName, riderPcsId, teamName, pos: posText, timeStr: timeText, gapStr: "" });
        }
      });
    }

    // ── Method 3: Broad fallback — any rider links in main content ──
    if (entries.length === 0) {
      let rnk = 1;
      document.querySelectorAll(".content a[href*='rider/'], #content a[href*='rider/'], main a[href*='rider/']").forEach(el => {
        const riderName = el.textContent?.trim() ?? "";
        const riderHref = el.getAttribute("href") ?? "";
        const riderPcsId = riderHref.replace(/^\//, "").split("rider/")[1]?.split("/")[0] ?? "";
        if (!riderName || !riderPcsId || riderName.length < 3) return;
        const li = el.closest("li, tr");
        const teamLink = li?.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
        entries.push({
          riderName, riderPcsId,
          teamName: teamLink?.textContent?.trim() ?? null,
          pos: String(rnk++),
          timeStr: "", gapStr: "",
        });
      });
    }

    return entries.map(e => ({ ...e, stage: stageN ?? null }));
  }, stageNum ?? null);

  if (results.length === 0) {
    console.log(`   ⚠️  No riders found in results page`);
    return [];
  }

  console.log(`   📊 Found ${results.length} rider entries`);

  // Parse positions / status
  const parsed: ParsedResult[] = [];
  for (const r of results) {
    const posUp = r.pos.toUpperCase().trim();
    const dnf = posUp === "DNF" || posUp === "OTL" || posUp === "ABD";
    const dns = posUp === "DNS" || posUp === "DQ" || posUp === "DSQ";
    const dsq = posUp === "DSQ" || posUp === "DQ";
    const position = (!dnf && !dns && !dsq && /^\d+$/.test(posUp)) ? parseInt(posUp, 10) : null;

    parsed.push({
      riderName: r.riderName,
      riderPcsId: r.riderPcsId,
      teamName: r.teamName,
      position,
      timeSeconds: parseTimeStr(r.timeStr),
      timeGapSeconds: parseGapStr(r.gapStr),
      dnf,
      dns,
      dsq,
      stage: r.stage ?? undefined,
    });
  }

  return parsed;
}

// ─── Detect stage count from PCS race page ────────────────────────────────────

async function detectStageCount(page: Page, pcsUrl: string): Promise<number> {
  try {
    await page.goto(pcsUrl, { waitUntil: "networkidle", timeout: 20000 });
    const stageLinks = await page.$$eval("a[href*='/stage-']", links =>
      links.map(l => {
        const m = (l.getAttribute("href") ?? "").match(/\/stage-(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      }).filter(n => n > 0)
    ).catch(() => [] as number[]);
    const max = stageLinks.length > 0 ? Math.max(...stageLinks) : 0;
    return max;
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
  race: RaceToProcess,
  browser: Browser
): Promise<{ inserted: number; status: string }> {

  if (!race.pcsUrl) {
    console.log(`⏭️  ${race.name}: no pcsUrl — needs LLM fallback`);
    return { inserted: 0, status: "no-pcsurl" };
  }

  const isStageRace = race.raceType === "stage_race" || race.endDate !== null;
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  let allResults: ParsedResult[] = [];

  try {
    if (isStageRace) {
      // For stage races: try to get today's/yesterday's stage result + current GC
      // First detect how many stages exist
      const stageCount = await detectStageCount(page, race.pcsUrl);
      console.log(`   Stage race: ${stageCount} stages detected`);

      if (stageCount > 0) {
        // Scrape the latest completed stage
        const today = new Date().toISOString().split("T")[0];
        const raceDate = race.date;
        const raceEnd = race.endDate ?? raceDate;
        const isFinished = today > raceEnd;

        if (isFinished) {
          // Race is over — get GC
          const gcResults = await scrapeResultsFromPage(page, `${race.pcsUrl}/gc`);
          if (gcResults.length > 0) allResults = gcResults;
          else {
            // Try final stage result as fallback
            allResults = await scrapeResultsFromPage(page, `${race.pcsUrl}/stage-${stageCount}/result`);
          }
        } else {
          // Race in progress — get most recent completed stage
          for (let s = stageCount; s >= 1; s--) {
            const stageResults = await scrapeResultsFromPage(page, `${race.pcsUrl}/stage-${s}/result`, s);
            if (stageResults.length > 0) {
              allResults = stageResults;
              break;
            }
          }
        }
      } else {
        // Could not detect stages — try /result and /gc
        const res = await scrapeResultsFromPage(page, `${race.pcsUrl}/result`);
        if (res.length > 0) allResults = res;
        else allResults = await scrapeResultsFromPage(page, `${race.pcsUrl}/gc`);
      }
    } else {
      // One-day race
      allResults = await scrapeResultsFromPage(page, `${race.pcsUrl}/result`);
    }
  } finally {
    await page.close().catch(() => {});
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

  const chromePath = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const raceRows: import("./lib/scrape-status").RaceRow[] = [];
  let totalInserted = 0;
  let totalNoResults = 0;

  try {
    for (const race of races) {
      console.log(`\n🔍 ${race.name} (${race.date})`);
      const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
      const { inserted, status } = await processRace(race, browser);
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
    await browser.close();
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
