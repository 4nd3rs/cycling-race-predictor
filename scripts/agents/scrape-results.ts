/**
 * Scrape Results Agent
 *
 * Scrapes race results from ProCyclingStats via scrape.do (bypasses Cloudflare).
 * Handles one-day races, stage races (per-stage + GC), and women's events.
 *
 * Usage:
 *   tsx scripts/agents/scrape-results.ts [--race-id <uuid>] [--days <n>] [--dry-run] [--force]
 *
 * Flags:
 *   --race-id  Process a specific race by UUID
 *   --days     How many days back to look (default: 14)
 *   --dry-run  Parse and print results without writing to DB
 *   --force    Re-scrape races already marked completed
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, or, isNull, ne, sql, isNotNull } from "drizzle-orm";
import { spawn } from "child_process";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";
import { scrapeDo } from "../../src/lib/scraper/scrape-do";

/** Fetch a PCS page via scrape.do (Cloudflare bypass) with retry */
async function fetchPCS(url: string, attempt = 1): Promise<string> {
  try {
    return await scrapeDo(url, { render: true, timeout: 30000 });
  } catch (e: any) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 5000));
      return fetchPCS(url, attempt + 1);
    }
    throw e;
  }
}
import { writeScrapeStatus, type RaceRow } from "./lib/scrape-status";
/** Run a script in background without blocking — fire and forget */
function fireAndForget(cmd: string, args: string[]): void {
  const child = spawn("node_modules/.bin/tsx", [cmd, ...args], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}


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
const daysBack = parseInt(getArg("days", "14"), 10);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force"); // re-scrape even completed races

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
  stage?: number;
}

// ─── Time parsers ─────────────────────────────────────────────────────────────

function parseTimeStr(raw: string): number | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const cleaned = raw.trim().replace(/\s+/g, "");
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

// ─── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── PCS results page scraper ────────────────────────────────────────────────

async function scrapeResultsFromPage(
  url: string,
  stageNum?: number,
  attempt = 1
): Promise<ParsedResult[]> {
  console.log(`   📄 Fetching: ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
  let html: string;
  try {
    html = await fetchPCS(url);
  } catch (err: any) {
    if (attempt < 3) {
      console.warn(`   ⚠️  scrape.do failed (${err.message}), retrying in ${attempt * 5}s…`);
      await sleep(attempt * 5000);
      return scrapeResultsFromPage(url, stageNum, attempt + 1);
    }
    console.error(`   ❌ scrape.do failed after ${attempt} attempts: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);

  // Detect "not found" / "no results yet"
  const title = $("title").text().toLowerCase();
  if (
    $(".page-not-found, .error-404, h1.red").length ||
    title.includes("not found") ||
    title.includes("error")
  ) {
    console.log(`   ⏳ No results page found (race may not have finished)`);
    return [];
  }

  // Try multiple table selectors — PCS occasionally changes class names
  const table =
    $("table.results").first().length ? $("table.results").first() :
    $("table[class*='result']").first().length ? $("table[class*='result']").first() :
    $("div.res-right table").first();

  const rawRows: Array<{ pos: string; riderName: string; riderPcsId: string; teamName: string | null; timeStr: string; gapStr: string }> = [];

  if (table.length) {
    const headers: string[] = [];
    table.find("thead th, thead td").each((_, th) => headers.push($(th).text().trim().toLowerCase()));
    const rnkIdx = headers.findIndex(h => h === "rnk" || h === "pos" || h === "#");
    const timeIdx = headers.findIndex(h => h === "time");
    const gapIdx = headers.findIndex(h => h === "gap" || h === "+");

    table.find("tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const posText = cells.eq(rnkIdx >= 0 ? rnkIdx : 0).text().trim();
      const riderLink = $(row).find("a[href*='rider/']").first();
      const riderName = riderLink.text().trim();
      const riderHref = riderLink.attr("href") || "";
      const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0]?.split("?")[0] || "";
      if (!riderName || !riderPcsId) return;
      const teamName = $(row).find("a[href*='team/']").text().trim() || null;
      const timeText = timeIdx >= 0 ? cells.eq(timeIdx).text().trim() : "";
      const gapText = gapIdx >= 0 ? cells.eq(gapIdx).text().trim() : "";
      rawRows.push({ pos: posText, riderName, riderPcsId, teamName, timeStr: timeText, gapStr: gapText });
    });
  } else {
    console.log(`   ⏳ Results table not found on page`);
    return [];
  }

  const parsed: ParsedResult[] = rawRows
    .map(r => {
      const posUp = r.pos.toUpperCase();
      const isDnf = posUp === "DNF";
      const isDns = posUp === "DNS";
      const isDsq = posUp === "DSQ" || posUp === "OTL";
      const position = isDnf || isDns || isDsq ? null : parseInt(r.pos, 10) || null;
      return {
        riderName: r.riderName,
        riderPcsId: r.riderPcsId,
        teamName: r.teamName,
        position,
        dnf: isDnf,
        dns: isDns,
        dsq: isDsq,
        timeSeconds: parseTimeStr(r.timeStr),
        timeGapSeconds: parseGapStr(r.gapStr),
        stage: stageNum,
      };
    })
    .filter(r => r.riderName && r.riderPcsId);

  console.log(`   ✅ Parsed ${parsed.length} results from ${url}`);
  return parsed;
}

// ─── Stage count detection ────────────────────────────────────────────────────

async function detectStageCount(pcsUrl: string): Promise<number> {
  try {
    const html = await fetchPCS(pcsUrl);
    const $ = cheerio.load(html);
    const nums: number[] = [];
    $("a[href*='/stage-']").each((_, el) => {
      const m = ($(el).attr("href") ?? "").match(/\/stage-(\d+)/);
      if (m) nums.push(parseInt(m[1], 10));
    });
    $("a, li").each((_, el) => {
      const m = $(el).text().trim().match(/^stage\s+(\d+)$/i);
      if (m) nums.push(parseInt(m[1], 10));
    });
    return nums.length > 0 ? Math.max(...nums) : 0;
  } catch {
    return 0;
  }
}

// ─── Stage metadata scraping ─────────────────────────────────────────────────

interface StageMetadata {
  stageNumber: number;
  name: string;
  date: string | null;
  profileType: string | null;
  distanceKm: string | null;
}

async function scrapeStageMetadata(pcsUrl: string, stageCount: number): Promise<StageMetadata[]> {
  const stages: StageMetadata[] = [];
  try {
    const html = await fetchPCS(pcsUrl);
    const $ = cheerio.load(html);

    // PCS stage overview often has a table or list with stage info
    // Try to extract from the overview/stages page
    $("a[href*='/stage-']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const m = href.match(/\/stage-(\d+)/);
      if (!m) return;
      const num = parseInt(m[1], 10);
      if (stages.find(s => s.stageNumber === num)) return;

      const row = $(el).closest("tr, li, div.stage");
      const text = row.length ? row.text() : $(el).text();

      // Try to extract date from row text — PCS uses DD/MM format (e.g. "13/03" = March 13)
      const dateMatch = text.match(/(\d{2})\/(\d{2})/);
      let dateStr: string | null = null;
      if (dateMatch) {
        const year = pcsUrl.match(/\/(\d{4})/)?.[1] ?? new Date().getFullYear().toString();
        const day = dateMatch[1];
        const month = dateMatch[2];
        dateStr = `${year}-${month}-${day}`;
      }

      // Try to extract distance
      const distMatch = text.match(/(\d{2,3}(?:\.\d)?)\s*km/i);

      // Try to extract profile type from icons or text
      let profileType: string | null = null;
      const profileText = text.toLowerCase();
      if (profileText.includes("mountain") || profileText.includes("summit")) profileType = "mountain";
      else if (profileText.includes("hilly")) profileType = "hilly";
      else if (profileText.includes("flat")) profileType = "flat";
      else if (profileText.includes("itt") || profileText.includes("time trial")) profileType = "tt";

      // Check for PCS profile icons (classes like p1-p5)
      const profileIcon = row.find("[class*='icon profile']").attr("class") || row.find("span[class*='p']").attr("class") || "";
      if (profileIcon.includes("p4") || profileIcon.includes("p5")) profileType = "mountain";
      else if (profileIcon.includes("p3")) profileType = "hilly";
      else if (profileIcon.includes("p1")) profileType = "flat";

      const stageName = $(el).text().trim() || `Stage ${num}`;

      stages.push({
        stageNumber: num,
        name: stageName,
        date: dateStr,
        profileType,
        distanceKm: distMatch?.[1] ?? null,
      });
    });
  } catch (err: any) {
    console.warn(`   ⚠️  Could not scrape stage metadata: ${err.message}`);
  }

  // Fill in any missing stages
  for (let i = 1; i <= stageCount; i++) {
    if (!stages.find(s => s.stageNumber === i)) {
      stages.push({ stageNumber: i, name: `Stage ${i}`, date: null, profileType: null, distanceKm: null });
    }
  }

  return stages.sort((a, b) => a.stageNumber - b.stageNumber);
}

// ─── Ensure stage child records exist ────────────────────────────────────────

async function ensureStageRecords(
  parentRace: RaceToProcess,
  stageCount: number,
  pcsUrl: string
): Promise<void> {
  // Check which stages already exist
  const existingStages = await db
    .select({ stageNumber: schema.races.stageNumber })
    .from(schema.races)
    .where(eq(schema.races.parentRaceId, parentRace.id));

  const existingNumbers = new Set(existingStages.map(s => s.stageNumber).filter(Boolean));

  const missingStages = [];
  for (let i = 1; i <= stageCount; i++) {
    if (!existingNumbers.has(i)) missingStages.push(i);
  }

  if (missingStages.length === 0) {
    console.log(`   ✅ All ${stageCount} stage records already exist`);
    return;
  }

  console.log(`   📝 Creating ${missingStages.length} stage records…`);

  // Scrape metadata for naming/dates
  const metadata = await scrapeStageMetadata(pcsUrl, stageCount);

  // Interpolate dates from parent race start/end if not scraped
  const startDate = new Date(parentRace.date);
  const endDate = parentRace.endDate ? new Date(parentRace.endDate) : new Date(startDate.getTime() + stageCount * 86400000);
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));

  // Get parent race's raceEventId from DB
  const [parentRow] = await db
    .select({ raceEventId: schema.races.raceEventId, uciCategory: schema.races.uciCategory, country: schema.races.country })
    .from(schema.races)
    .where(eq(schema.races.id, parentRace.id))
    .limit(1);

  for (const stageNum of missingStages) {
    const meta = metadata.find(m => m.stageNumber === stageNum);

    // Interpolate date if not available from scraping
    let stageDate: string;
    if (meta?.date) {
      stageDate = meta.date;
    } else {
      const dayOffset = Math.round(((stageNum - 1) / Math.max(1, stageCount - 1)) * totalDays);
      const d = new Date(startDate.getTime() + dayOffset * 86400000);
      stageDate = d.toISOString().split("T")[0];
    }

    const stageName = meta?.name || `Stage ${stageNum}`;
    const pcsStageUrl = `${pcsUrl}/stage-${stageNum}`;

    await db.insert(schema.races).values({
      name: `${parentRace.name} - ${stageName}`,
      date: stageDate,
      discipline: parentRace.discipline,
      raceType: "stage",
      profileType: meta?.profileType ?? null,
      ageCategory: parentRace.ageCategory,
      gender: parentRace.gender,
      distanceKm: meta?.distanceKm ?? null,
      parentRaceId: parentRace.id,
      stageNumber: stageNum,
      raceEventId: parentRow?.raceEventId ?? null,
      uciCategory: parentRow?.uciCategory ?? null,
      country: parentRow?.country ?? null,
      pcsUrl: pcsStageUrl,
      status: "active",
    });
  }

  console.log(`   ✅ Created ${missingStages.length} stage records`);
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

// Cache rider lookups to avoid repeated full-table scans
let riderCache: Map<string, string> | null = null;

async function getRiderCache(): Promise<Map<string, string>> {
  if (riderCache) return riderCache;
  const all = await db.select({ id: schema.riders.id, name: schema.riders.name, pcsId: schema.riders.pcsId })
    .from(schema.riders)
    .limit(20000);
  riderCache = new Map();
  for (const r of all) {
    if (r.pcsId) riderCache.set(`pcs:${r.pcsId}`, r.id);
    riderCache.set(`name:${stripAccents(r.name)}`, r.id);
    riderCache.set(`norm:${normalizeName(r.name)}`, r.id);
  }
  return riderCache;
}

async function findOrCreateRider(name: string, pcsId: string): Promise<string> {
  const cache = await getRiderCache();

  if (pcsId && cache.has(`pcs:${pcsId}`)) return cache.get(`pcs:${pcsId}`)!;

  const stripped = stripAccents(name);
  if (cache.has(`name:${stripped}`)) {
    const id = cache.get(`name:${stripped}`)!;
    if (pcsId) { await db.update(schema.riders).set({ pcsId }).where(eq(schema.riders.id, id)); cache.set(`pcs:${pcsId}`, id); }
    return id;
  }

  const norm = normalizeName(name);
  if (cache.has(`norm:${norm}`)) {
    const id = cache.get(`norm:${norm}`)!;
    if (pcsId) { await db.update(schema.riders).set({ pcsId }).where(eq(schema.riders.id, id)); cache.set(`pcs:${pcsId}`, id); }
    return id;
  }

  const [created] = await db
    .insert(schema.riders)
    .values({ name, pcsId: pcsId || undefined })
    .returning({ id: schema.riders.id });

  cache.set(`pcs:${pcsId}`, created.id);
  cache.set(`name:${stripped}`, created.id);
  cache.set(`norm:${norm}`, created.id);
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

  // Bulk-fetch existing results for this race (avoid N+1 existence checks)
  const existing = await db
    .select({ riderId: schema.raceResults.riderId })
    .from(schema.raceResults)
    .where(eq(schema.raceResults.raceId, raceId));
  const existingRiderIds = new Set(existing.map(r => r.riderId));

  for (const r of results) {
    try {
      const teamId = r.teamName ? await findOrCreateTeam(r.teamName) : null;
      const riderId = await findOrCreateRider(r.riderName, r.riderPcsId);

      if (existingRiderIds.has(riderId)) { skipped++; continue; }

      await db.insert(schema.raceResults).values({
        raceId,
        riderId,
        teamId: teamId ?? null,
        position: r.position,
        timeSeconds: r.timeSeconds,
        timeGapSeconds: r.timeGapSeconds,
        dnf: r.dnf,
        dns: r.dns,
        dsq: r.dsq,
      });
      existingRiderIds.add(riderId);
      inserted++;

      // Ensure rider discipline stats exist
      await db.insert(schema.riderDisciplineStats).values({
        riderId, discipline, ageCategory, gender,
        currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
      }).onConflictDoNothing();
    } catch (err: any) {
      console.error(`   ❌ ${r.riderName}: ${err.message}`);
      errors++;
    }
  }

  return { inserted, skipped, errors };
}


// ─── PCS URL auto-discovery & healing (road only) ────────────────────────────

function slugifyRaceName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*[-–|]\s*(elite|u23|under 23|junior|men|women|masculin|feminin).*$/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim().replace(/^-|-$/g, "");
}

async function tryPCSUrl(url: string): Promise<number> {
  try {
    const html = await fetchPCS(url);
    const $ = cheerio.load(html);
    const title = $("title").text().toLowerCase();
    if (title.includes("not found") || title.includes("error")) return 0;
    const table = $("table.results, table[class*=\'result\']").first();
    if (!table.length) return 0;
    return table.find("tbody tr").length;
  } catch { return 0; }
}

async function discoverPCSUrl(race: RaceToProcess): Promise<string | null> {
  if (race.discipline === "mtb") return null;
  // Only attempt discovery for races within 14 days — avoid burning scrape.do for distant races
  const raceMs = new Date(race.date).getTime();
  const daysUntil = (raceMs - Date.now()) / 86400000;
  const daysSince = (Date.now() - raceMs) / 86400000;
  if (daysUntil > 14 || daysSince > 7) return null; // too far in future or too old
  const year = race.date.substring(0, 4);
  const slug = slugifyRaceName(race.name);
  if (!slug) return null;

  const candidates = [
    `https://www.procyclingstats.com/race/${slug}/${year}`,
    `https://www.procyclingstats.com/race/${slug}`,
  ];

  for (const url of candidates) {
    const resultUrl = `${url}/result`;
    console.log(`   🔍 Trying: ${resultUrl}`);
    const count = await tryPCSUrl(resultUrl);
    if (count > 5) {
      console.log(`   ✅ Discovered: ${url} (${count} results)`);
      await db.update(schema.races).set({ pcsUrl: url }).where(eq(schema.races.id, race.id));
      return url;
    }
    await sleep(1000);
  }
  return null;
}

async function healPCSUrl(race: RaceToProcess): Promise<string | null> {
  if (!race.pcsUrl || race.discipline === "mtb") return null;
  const url = race.pcsUrl;
  const year = new Date().getFullYear();

  const variants = [
    url.replace("brussels", "brussel"),
    url.replace("brussel", "brussels"),
    url.replace("ghent", "gent"),
    url.replace("gent-", "ghent-"),
    url.replace(/\/\d{4}$/, `/${year}`),
  ].filter(v => v !== url);

  for (const variant of variants) {
    const resultUrl = `${variant}/result`;
    console.log(`   🔧 Trying variant: ${resultUrl}`);
    const count = await tryPCSUrl(resultUrl);
    if (count > 5) {
      console.log(`   🔧 Healed pcsUrl: ${url} → ${variant}`);
      await db.update(schema.races).set({ pcsUrl: variant }).where(eq(schema.races.id, race.id));
      return variant;
    }
    await sleep(1000);
  }
  return null;
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
  raceInput: RaceToProcess
): Promise<{ inserted: number; status: string }> {
  let race = raceInput;

  // Auto-discover pcsUrl for road races missing it
  if (!race.pcsUrl && race.discipline !== "mtb") {
    console.log(`   🔍 Auto-discovering pcsUrl for ${race.name}…`);
    const discovered = await discoverPCSUrl(race);
    if (discovered) {
      race = { ...race, pcsUrl: discovered };
    } else {
      console.log(`   ⏭️  Could not discover pcsUrl — skipping`);
      return { inserted: 0, status: "no-pcsurl" };
    }
  } else if (!race.pcsUrl) {
    console.log(`⏭️  ${race.name}: no pcsUrl — skipping`);
    return { inserted: 0, status: "no-pcsurl" };
  }

  const isStageRace = race.raceType === "stage_race" || (race.endDate !== null && race.endDate !== race.date);
  let allResults: ParsedResult[] = [];
  let totalStageInserts = 0;

  if (isStageRace) {
    const stageCount = await detectStageCount(race.pcsUrl);
    console.log(`   Stage race: ${stageCount} stages detected`);

    if (stageCount > 0) {
      // Phase 1: Ensure child stage records exist
      await ensureStageRecords(race, stageCount, race.pcsUrl);

      // Get stage records for result routing
      const stageRecords = await db
        .select({ id: schema.races.id, stageNumber: schema.races.stageNumber, status: schema.races.status })
        .from(schema.races)
        .where(eq(schema.races.parentRaceId, race.id))
        .orderBy(schema.races.stageNumber);

      const today = new Date().toISOString().split("T")[0];
      const raceEnd = race.endDate ?? race.date;
      const isFinished = today > raceEnd;

      // Phase 2: Import per-stage results into child records
      for (const stageRec of stageRecords) {
        if (!stageRec.stageNumber) continue;
        if (stageRec.status === "completed" && !force) continue;

        const stageResults = await scrapeResultsFromPage(
          `${race.pcsUrl}/stage-${stageRec.stageNumber}/result`,
          stageRec.stageNumber
        );

        if (stageResults.length > 0) {
          const finishers = stageResults.filter(r => !r.dns && !r.dnf && !r.dsq).length;
          if (finishers >= 5) {
            if (dryRun) {
              console.log(`   🔍 [dry-run] Stage ${stageRec.stageNumber}: ${stageResults.length} results`);
            } else {
              const { inserted } = await importResults(
                stageRec.id, stageResults, race.discipline, race.ageCategory, race.gender
              );
              totalStageInserts += inserted;
              if (inserted > 0 || finishers > 0) {
                await db.update(schema.races)
                  .set({ status: "completed", updatedAt: new Date() })
                  .where(eq(schema.races.id, stageRec.id));
              }
              console.log(`   📊 Stage ${stageRec.stageNumber}: ${inserted} results imported`);
            }
          }
        }
        await sleep(1500);
      }

      // GC results: scrape into parent race record (after race finishes or latest available)
      if (isFinished) {
        const gcResults = await scrapeResultsFromPage(`${race.pcsUrl}/gc`);
        allResults = gcResults.length > 0 ? gcResults : await scrapeResultsFromPage(`${race.pcsUrl}/stage-${stageCount}/result`);
      } else {
        // During race: try to get current GC standings
        const gcResults = await scrapeResultsFromPage(`${race.pcsUrl}/gc`);
        if (gcResults.length > 0) {
          allResults = gcResults;
        }
      }
    } else {
      const res = await scrapeResultsFromPage(`${race.pcsUrl}/result`);
      allResults = res.length > 0 ? res : await scrapeResultsFromPage(`${race.pcsUrl}/gc`);
    }
  } else {
    // One-day race — up to 2 attempts, then try URL healing
    allResults = await scrapeResultsFromPage(`${race.pcsUrl}/result`);
    if (allResults.length === 0) {
      await sleep(3000);
      allResults = await scrapeResultsFromPage(`${race.pcsUrl}/result`, undefined, 2);
    }
    if (allResults.length === 0 && race.pcsUrl) {
      const healed = await healPCSUrl(race);
      if (healed) {
        race = { ...race, pcsUrl: healed };
        allResults = await scrapeResultsFromPage(`${healed}/result`);
      }
    }
  }

  // For stage races with no GC yet but stage results imported, return success
  if (allResults.length === 0 && totalStageInserts > 0) {
    console.log(`   ✅ ${totalStageInserts} stage results imported (GC not yet available)`);
    return { inserted: totalStageInserts, status: "imported" };
  }

  if (allResults.length === 0) {
    return { inserted: 0, status: "no-results-yet" };
  }

  // Sanity: need enough actual finishers before treating as real results.
  // Guards against early scrapes that only catch DNS/DNF riders (race still in progress).
  const finisherCount = allResults.filter(r => !r.dns && !r.dnf && !r.dsq).length;
  const minFinishers = allResults.length > 50 ? 20 : 5; // big races need 20+, small races 5+
  if (finisherCount < minFinishers) {
    console.warn(`   ⚠️  Only ${finisherCount} finishers / ${allResults.length} total (need ${minFinishers}) — skipping (race likely in progress or data incomplete)`);
    return { inserted: totalStageInserts, status: totalStageInserts > 0 ? "imported" : "incomplete" };
  }

  if (dryRun) {
    console.log(`   🔍 [dry-run] Would import ${allResults.length} GC results (${finisherCount} finishers)`);
    return { inserted: allResults.length + totalStageInserts, status: "dry-run" };
  }

  const { inserted, skipped, errors } = await importResults(
    race.id, allResults, race.discipline, race.ageCategory, race.gender
  );

  const totalInserted = inserted + totalStageInserts;

  if (inserted > 0 || (skipped > 0 && force)) {
    await db.update(schema.races)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(schema.races.id, race.id));

    // ELO: only run on parent (GC results) to avoid noisy per-stage updates
    if (inserted > 0) {
      try {
        const eloUpdates = await processRaceElo(race.id);
        console.log(`   🎯 ELO: ${eloUpdates} rider ratings updated (GC only)`);
      } catch (err: any) {
        console.warn(`   ⚠️  ELO update failed: ${err.message}`);
      }

      // Fire-and-forget: refresh predictions + trigger marketing (non-blocking)
      if (!dryRun) {
        // Refresh predictions for upcoming races of same discipline
        fireAndForget("scripts/agents/generate-predictions.ts", ["--discipline", race.discipline, "--days", "30"]);
        console.log(`   🔮 Predictions refresh queued for ${race.discipline}`);

        // Post-race analysis: compare predictions vs results for road elite races
        if (race.discipline === "road" && race.ageCategory === "elite") {
          fireAndForget("scripts/agents/analyze-race-results.ts", ["--race-id", race.id]);
          console.log(`   📝 Post-race analysis queued`);
        }

        // Marketing: only for WorldTour / 2.Pro / 1.Pro / major MTB — skip NC/2.2/lower
        const significantCats = new Set(["WorldTour", "2.Pro", "1.Pro", "2.HC", "1.HC", "1.1", "2.1"]);
        const isSignificant = race.discipline === "mtb" || significantCats.has((race as any).uciCategory ?? "");
        if (isSignificant) {
          fireAndForget("scripts/agents/marketing-agent.ts", []);
          console.log(`   📣 Marketing agent queued`);
        }
      }
    }
  }

  console.log(`   ✅ GC: ${inserted} inserted, ${skipped} existing, ${errors} errors. Stages: ${totalStageInserts} total.`);
  return {
    inserted: totalInserted,
    status: totalInserted > 0 ? "imported" : skipped > 0 ? "already-done" : "error",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏁 PCS Results Scraper${dryRun ? " [DRY RUN]" : ""}${force ? " [FORCE]" : ""}`);
  console.log(`─────────────────────────────`);

  const today = new Date().toISOString().split("T")[0];
  const pastDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  let races: RaceToProcess[];

  if (raceIdArg) {
    const r = await db.query.races.findFirst({ where: eq(schema.races.id, raceIdArg) });
    races = r ? [{
      id: r.id, name: r.name, date: r.date, endDate: r.endDate ?? null,
      discipline: r.discipline, raceType: r.raceType ?? null,
      ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men",
      pcsUrl: r.pcsUrl ?? null, status: r.status ?? null,
    }] : [];
  } else {
    // NULL-safe "not completed" filter — critical: SQL NULL != 'completed' evaluates to NULL (false)
    const notCompleted = or(isNull(schema.races.status), ne(schema.races.status, "completed"));
    const statusFilter = force ? undefined : notCompleted;

    // Q1: races that started within the lookback window
    const q1Conditions = [
      gte(schema.races.date, pastDate),
      lte(schema.races.date, today),
      ...(statusFilter ? [statusFilter] : []),
    ];

    // Q2: stage races started before window but ending within it (ongoing tours)
    const q2Conditions = [
      sql`(${schema.races.raceType} = 'stage_race' OR ${schema.races.endDate} IS NOT NULL)`,
      sql`${schema.races.date} < ${pastDate}`,
      sql`${schema.races.endDate} >= ${pastDate}`,
      sql`${schema.races.endDate} <= ${tomorrow}`,
      ...(statusFilter ? [statusFilter] : []),
    ];

    const selectFields = {
      id: schema.races.id, name: schema.races.name, date: schema.races.date,
      endDate: schema.races.endDate, discipline: schema.races.discipline,
      raceType: schema.races.raceType, ageCategory: schema.races.ageCategory,
      gender: schema.races.gender, pcsUrl: schema.races.pcsUrl, status: schema.races.status,
    };

    const [rows1, rows2] = await Promise.all([
      db.select(selectFields).from(schema.races).where(and(...q1Conditions)),
      db.select(selectFields).from(schema.races).where(and(...q2Conditions)),
    ]);

    const seen = new Set<string>();
    races = [...rows1, ...rows2]
      .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map(r => ({
        ...r, endDate: r.endDate ?? null, raceType: r.raceType ?? null,
        ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men",
        pcsUrl: r.pcsUrl ?? null, status: r.status ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  if (races.length === 0) {
    console.log("No races needing results.");
    writeScrapeStatus({ component: "results", status: "ok", summary: "No races needing results" });
    return;
  }

  const withPcs = races.filter(r => r.pcsUrl);
  const noPcs = races.filter(r => !r.pcsUrl);

  console.log(`Found ${races.length} race(s) needing results (${withPcs.length} with PCS URL, ${noPcs.length} without)\n`);
  races.forEach(r => {
    const suffix = r.pcsUrl ? "" : " — ⚠️ no pcsUrl";
    const statusLabel = r.status ? ` [${r.status}]` : "";
    console.log(`  • ${r.name} (${r.date})${statusLabel}${suffix}`);
  });
  console.log();

  const raceRows: RaceRow[] = [];
  let totalInserted = 0;
  let totalNoResults = 0;

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
      status === "incomplete" ? "⚠️ incomplete" :
      status === "dry-run" ? "🔍 dry-run" : "❌ error";

    raceRows.push({ name: race.name, date: race.date, count: inserted, status: statusEmoji, scrapedAt: now });

    if (races.indexOf(race) < races.length - 1) await sleep(2000);
  }

  writeScrapeStatus({
    component: "results",
    status: totalInserted > 0 ? "ok" : totalNoResults === races.length ? "ok" : "warn",
    summary: `${totalInserted} results imported across ${races.length} race(s). ${noPcs.length} race(s) missing pcsUrl.`,
    raceRows,
  });

  // ── Stale race detection ──────────────────────────────────────────────────
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const staleRows = await db.select({
    id: schema.races.id, name: schema.races.name, date: schema.races.date, pcsUrl: schema.races.pcsUrl,
  })
  .from(schema.races)
  .where(and(
    or(isNull(schema.races.status), ne(schema.races.status, "completed")),
    isNotNull(schema.races.pcsUrl),
    sql`${schema.races.date} < ${yesterday}`,
    sql`${schema.races.discipline} = 'road'`,
  ));

  if (staleRows.length > 0) {
    console.log(`\n⚠️  ${staleRows.length} stale road race(s) — results overdue:`);
    staleRows.forEach(r => {
      const days = Math.floor((Date.now() - new Date(r.date).getTime()) / 86400000);
      console.log(`   • ${r.name} (${r.date}) — ${days}d overdue`);
    });
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Total: ${totalInserted} results imported`);
  if (noPcs.length > 0) {
    console.log(`\n⚠️  ${noPcs.length} road race(s) have no pcsUrl:`);
    noPcs.forEach(r => console.log(`   • ${r.name} (${r.date})`));
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
