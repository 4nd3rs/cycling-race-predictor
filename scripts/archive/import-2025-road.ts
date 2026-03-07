/**
 * import-2025-road.ts
 *
 * Imports all 2025 road race results from ProCyclingStats.
 * Covers: WorldTour, ProSeries, U23, Junior (men + women).
 * 
 * Processes races in chronological order (oldest first) so TrueSkill
 * ratings compound correctly.
 *
 * Usage:
 *   tsx scripts/agents/import-2025-road.ts [--dry-run] [--circuit N] [--fresh]
 *
 * Checkpoint: scripts/agents/import-progress-road-2025.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium, type Browser, type Page } from "playwright";
import { findOrCreateRider, findOrCreateTeam } from "../../src/lib/riders/find-or-create";
import { processRaceElo } from "../../src/lib/prediction/process-race-elo";
import * as fs from "fs";
import * as path from "path";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FRESH = args.includes("--fresh");
const circuitArg = args.indexOf("--circuit") !== -1 ? parseInt(args[args.indexOf("--circuit") + 1], 10) : null;

const CHECKPOINT_FILE = path.resolve(__dirname, "import-progress-road-2025.json");
const RATE_LIMIT_MS = 1500;
let lastRequestTime = 0;

// ─── Checkpoint ───────────────────────────────────────────────────────────────
interface Checkpoint {
  completedPcsUrls: string[];
  failedPcsUrls: string[];
}

function loadCheckpoint(): Checkpoint {
  if (!FRESH && fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch {
      // ignore
    }
  }
  return { completedPcsUrls: [], failedPcsUrls: [] };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf-8");
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
}

// ─── Circuit definitions ──────────────────────────────────────────────────────
// Mapped after discovery from PCS races.php?year=2025
interface CircuitDef {
  id: number;
  ageCategory: "elite" | "u23" | "junior";
  gender: "men" | "women";
  label: string;
}

// PCS circuit IDs for 2025 road racing (verified from races.php select options)
const KNOWN_CIRCUITS: CircuitDef[] = [
  { id: 1,  ageCategory: "elite",  gender: "men",   label: "UCI WorldTour" },
  { id: 24, ageCategory: "elite",  gender: "women", label: "UCI Women's WorldTour" },
  { id: 26, ageCategory: "elite",  gender: "men",   label: "UCI ProSeries" },   // contains both genders, detect per-race below
  { id: 16, ageCategory: "elite",  gender: "women", label: "Women Elite" },
  { id: 13, ageCategory: "elite",  gender: "men",   label: "Europe Tour" },
  { id: 2,  ageCategory: "elite",  gender: "men",   label: "World Championships" }, // has both genders
  { id: 21, ageCategory: "u23",    gender: "men",   label: "Nations Cup (U23/Junior)" },
  { id: 15, ageCategory: "junior", gender: "men",   label: "Men Junior" },
  { id: 17, ageCategory: "junior", gender: "women", label: "Women Junior" },
];

// Detect gender from race name (PCS often uses ME/WE suffixes or "Women"/"Men" in name)
function detectGenderFromName(name: string, defaultGender: "men" | "women"): "men" | "women" {
  const n = name.toLowerCase();
  if (n.includes(" we") || n.includes("women") || n.includes("féminin") || n.includes("dames") || n.endsWith(" we")) return "women";
  if (n.includes(" me") || n.includes("men elite") || n.endsWith(" me")) return "men";
  return defaultGender;
}

// Detect ageCategory from race name or circuit context
function detectAgeCategoryFromName(name: string, defaultCat: "elite" | "u23" | "junior"): "elite" | "u23" | "junior" {
  const n = name.toLowerCase();
  if (n.includes("junior") || n.includes("junioren")) return "junior";
  if (n.includes("u23") || n.includes("under 23") || n.includes("espoirs")) return "u23";
  return defaultCat;
}

// ─── PCS races.php scraper ────────────────────────────────────────────────────
interface PCSRaceEntry {
  name: string;
  pcsUrl: string;   // full https:// URL
  slug: string;     // e.g. "tour-de-france"
  date: string;     // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD for stage races
  uciCategory: string | null;
  country: string | null;
  isStageRace: boolean;
  circuit: CircuitDef;
}

async function discoverCircuits(page: Page): Promise<CircuitDef[]> {
  await rateLimit();
  await page.goto("https://www.procyclingstats.com/races.php?year=2025&circuit=1", {
    waitUntil: "networkidle", timeout: 30000,
  });
  await page.waitForTimeout(1000);

  // Parse circuit select options
  const options = await page.evaluate(() => {
    const sel = document.querySelector("select[name='circuit']");
    if (!sel) return [];
    return Array.from((sel as HTMLSelectElement).options).map(o => ({
      value: parseInt(o.value, 10),
      text: o.text.trim(),
    }));
  }).catch(() => [] as {value:number; text:string}[]);

  console.log(`   Found ${options.length} circuits on PCS`);

  // Just use KNOWN_CIRCUITS — all relevant ones are hardcoded from page discovery
  const circuits: CircuitDef[] = [...KNOWN_CIRCUITS];
  console.log(`   Total circuits to process: ${circuits.length} (${circuits.map(c => c.id).join(", ")})`);
  return circuits;
}

async function fetchCircuitRaces(page: Page, circuit: CircuitDef): Promise<PCSRaceEntry[]> {
  await rateLimit();
  const url = `https://www.procyclingstats.com/races.php?year=2025&circuit=${circuit.id}`;
  console.log(`\n  📋 Fetching ${circuit.label} (circuit ${circuit.id})`);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1200);
  } catch (err: any) {
    console.error(`  ❌ Failed to load circuit ${circuit.id}: ${err.message}`);
    return [];
  }

  const races = await page.evaluate(() => {
    const entries: {
      name: string; href: string; date: string; endDate: string; category: string; country: string;
    }[] = [];

    // Use JS filter instead of CSS attribute selector (more reliable for absolute hrefs)
    const allLinks = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    const raceLinks = allLinks.filter(a =>
      a.href.includes("/race/") && a.href.includes("/2025")
    );

    raceLinks.forEach(link => {
      const href = link.href || "";
      const name = link.textContent?.trim() ?? "";
      if (!name || name.length < 3) return;

      const row = link.closest("tr, li, .row") as HTMLElement | null;
      const rowText = row?.textContent ?? link.closest("td")?.textContent ?? "";

      // PCS date format: "16.01" or "16.01 > 21.01"
      const dateMatch = rowText.match(/(\d{1,2}[./]\d{2}(?:[./]\d{4})?)/);
      const date = dateMatch ? dateMatch[0] : "";

      // UCI category
      const catMatch = rowText.match(/\b(WorldTour|WT|1\.Pro|2\.Pro|1\.1|2\.1|1\.HC|2\.HC|JN|CN|NC)\b/i);
      const category = catMatch ? catMatch[0] : "";

      // Country flag
      const flag = row?.querySelector("[class*='flag-']") as HTMLElement | null;
      const country = flag?.className?.match(/flag-([a-z]{2,3})/i)?.[1]?.toUpperCase() ?? "";

      entries.push({ name, href, date, endDate: "", category, country });
    });

    return entries;
  });

  const parsed: PCSRaceEntry[] = [];
  for (const r of races) {
    const match = r.href.match(/\/race\/([^/]+)\/2025/);
    if (!match) continue;
    const slug = match[1];
    const pcsUrl = `https://www.procyclingstats.com/race/${slug}/2025`;

    // Parse date — PCS uses "DD.MM" or "DD.MM > DD.MM" format (year is always 2025)
    let date = "2025-01-01";
    const rawDate = r.date.trim();
    // Try DD.MM or DD/MM format
    const ddmm = rawDate.match(/^(\d{1,2})[./](\d{2})/);
    if (ddmm) {
      date = `2025-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
    } else {
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
      } catch {}
    }

    // Override gender/ageCategory from race name for mixed circuits (ProSeries, WC, Nations Cup)
    const detectedGender = detectGenderFromName(r.name, circuit.gender);
    const detectedAgeCat = detectAgeCategoryFromName(r.name, circuit.ageCategory);

    parsed.push({
      name: r.name,
      pcsUrl,
      slug,
      date: date || "2025-01-01",
      uciCategory: r.category || null,
      country: r.country || null,
      isStageRace: false,
      circuit: { ...circuit, gender: detectedGender, ageCategory: detectedAgeCat },
    });
  }

  // Deduplicate by pcsUrl
  const seen = new Set<string>();
  const deduped = parsed.filter(r => {
    if (seen.has(r.pcsUrl)) return false;
    seen.add(r.pcsUrl);
    return true;
  });

  console.log(`     Found ${deduped.length} races`);
  return deduped;
}

// ─── PCS result scraper ───────────────────────────────────────────────────────
interface ParsedResult {
  riderName: string;
  riderPcsId: string;
  teamName: string | null;
  position: number | null;
  timeSeconds: number | null;
  timeGapSeconds: number | null;
  uciPoints: number | null;
  dnf: boolean;
  dns: boolean;
  stageNum?: number;
}

function parseTime(raw: string): number | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const cleaned = raw.trim().replace(/\s+/g, "").replace(/^[+\s]+/, "");
  const parts = cleaned.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

async function scrapeResultsPage(page: Page, url: string, stageNum?: number): Promise<ParsedResult[]> {
  await rateLimit();
  console.log(`    📄 ${url}`);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1200);
  } catch (err: any) {
    console.error(`    ❌ Nav failed: ${err.message}`);
    return [];
  }

  // Check for no-results
  const notFound = await page.$(".page-not-found, .error-404").catch(() => null);
  if (notFound) return [];

  const results = await page.evaluate((stageN) => {
    const entries: {
      riderName: string; riderPcsId: string; teamName: string | null;
      pos: string; timeStr: string; gapStr: string; uciPts: string;
    }[] = [];

    const table = document.querySelector("table.results, table[class*='result']") as HTMLTableElement | null;
    if (table) {
      const headers = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent?.trim().toLowerCase() ?? "");
      const rnkIdx = headers.findIndex(h => h === "rnk" || h === "#" || h === "pos");
      const gapIdx = headers.findIndex(h => h === "gap" || h === "+");
      const timeIdx = headers.findIndex(h => h === "time" || h === "finish" || h === "avg");
      const uciIdx = headers.findIndex(h => h.includes("uci") || h === "pts");

      table.querySelectorAll("tbody tr").forEach(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 3) return;
        const riderLink = tr.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
        const teamLink = tr.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
        if (!riderLink) return;
        const riderName = riderLink.textContent?.trim() ?? "";
        const href = riderLink.getAttribute("href") ?? "";
        const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0]?.split("?")[0] ?? "";
        const teamName = teamLink?.textContent?.trim() ?? null;
        const posText = tds[rnkIdx > 0 ? rnkIdx : 0]?.textContent?.trim() ?? "";
        const timeText = timeIdx > 0 ? (tds[timeIdx]?.textContent?.trim() ?? "") : "";
        const gapText = gapIdx > 0 ? (tds[gapIdx]?.textContent?.trim() ?? "") : "";
        const uciText = uciIdx > 0 ? (tds[uciIdx]?.textContent?.trim() ?? "") : "";
        if (riderName && riderPcsId) entries.push({ riderName, riderPcsId, teamName, pos: posText, timeStr: timeText, gapStr: gapText, uciPts: uciText });
      });
    }

    // Fallback: .resultlistbase
    if (entries.length === 0) {
      let rnk = 1;
      document.querySelectorAll(".resultlistbase li, ul.list.moblist li").forEach(li => {
        const riderLink = li.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
        if (!riderLink) return;
        const riderName = riderLink.textContent?.trim() ?? "";
        const href = riderLink.getAttribute("href") ?? "";
        const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0] ?? "";
        const teamLink = li.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
        const posEl = li.querySelector(".rnk, .pos");
        const posText = posEl?.textContent?.trim() ?? String(rnk++);
        if (riderName && riderPcsId) entries.push({ riderName, riderPcsId, teamName: teamLink?.textContent?.trim() ?? null, pos: posText, timeStr: "", gapStr: "", uciPts: "" });
      });
    }

    return entries;
  }, stageNum ?? null);

  if (results.length === 0) {
    console.log(`    ⚠️  No results found`);
    return [];
  }

  return results.map(r => {
    const posUp = r.pos.toUpperCase().trim();
    const dnf = posUp === "DNF" || posUp === "OTL" || posUp === "ABD";
    const dns = posUp === "DNS" || posUp === "DSQ" || posUp === "DQ";
    const position = (!dnf && !dns && /^\d+$/.test(posUp)) ? parseInt(posUp, 10) : null;
    const uciPoints = r.uciPts ? parseInt(r.uciPts.replace(/[^\d]/g, ""), 10) || null : null;
    return {
      riderName: r.riderName,
      riderPcsId: r.riderPcsId,
      teamName: r.teamName,
      position,
      timeSeconds: parseTime(r.timeStr),
      timeGapSeconds: parseTime(r.gapStr),
      uciPoints,
      dnf,
      dns,
      stageNum,
    };
  });
}

async function detectStages(page: Page, pcsUrl: string): Promise<number> {
  // Check if PCS race page has stage links
  try {
    await rateLimit();
    await page.goto(pcsUrl, { waitUntil: "networkidle", timeout: 25000 });
    const stageLinks = await page.$$eval("a[href*='/stage-']", links =>
      links.map(l => {
        const m = (l.getAttribute("href") ?? "").match(/\/stage-(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      }).filter(n => n > 0)
    ).catch(() => [] as number[]);
    return stageLinks.length > 0 ? Math.max(...stageLinks) : 0;
  } catch {
    return 0;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function findOrCreateRaceEvent(name: string, date: string, discipline: string): Promise<string> {
  const existing = await db.query.raceEvents.findFirst({
    where: and(
      eq(schema.raceEvents.name, name),
      eq(schema.raceEvents.discipline, discipline)
    ),
  });
  if (existing) return existing.id;

  const slug = slugify(name) + "-" + date.substring(0, 4);
  const [created] = await db.insert(schema.raceEvents).values({
    name,
    slug,
    date,
    discipline,
    sourceType: "pcs",
  }).returning({ id: schema.raceEvents.id });
  return created.id;
}

async function findOrCreateRace(opts: {
  name: string;
  date: string;
  endDate?: string;
  discipline: string;
  ageCategory: string;
  gender: string;
  raceType: string;
  uciCategory: string | null;
  country: string | null;
  pcsUrl: string;
  raceEventId: string;
  parentRaceId?: string;
  stageNumber?: number;
}): Promise<{ id: string; alreadyHasResults: boolean }> {
  const existing = await db.query.races.findFirst({
    where: eq(schema.races.pcsUrl, opts.pcsUrl),
  });

  if (existing) {
    // Check if it already has results
    const resultCount = await db
      .select({ c: sql<number>`count(*)` })
      .from(schema.raceResults)
      .where(eq(schema.raceResults.raceId, existing.id));
    return { id: existing.id, alreadyHasResults: (resultCount[0]?.c ?? 0) > 0 };
  }

  const catSlug = `${opts.ageCategory}-${opts.gender}`;
  const [created] = await db.insert(schema.races).values({
    name: opts.name,
    categorySlug: catSlug,
    date: opts.date,
    endDate: opts.endDate ?? null,
    discipline: opts.discipline,
    ageCategory: opts.ageCategory,
    gender: opts.gender,
    raceType: opts.raceType,
    uciCategory: opts.uciCategory,
    country: opts.country,
    pcsUrl: opts.pcsUrl,
    raceEventId: opts.raceEventId,
    parentRaceId: opts.parentRaceId ?? null,
    stageNumber: opts.stageNumber ?? null,
    status: "active",
  }).returning({ id: schema.races.id });
  return { id: created.id, alreadyHasResults: false };
}

async function insertResults(
  raceId: string,
  results: ParsedResult[],
  discipline: string,
  ageCategory: string,
  gender: string
): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0, skipped = 0, errors = 0;
  for (const r of results) {
    try {
      const team = r.teamName ? await findOrCreateTeam(r.teamName, discipline) : null;
      const rider = await findOrCreateRider({ name: r.riderName, pcsId: r.riderPcsId || undefined });

      // Check duplicate
      const dup = await db.select({ id: schema.raceResults.id })
        .from(schema.raceResults)
        .where(and(eq(schema.raceResults.raceId, raceId), eq(schema.raceResults.riderId, rider.id)))
        .limit(1);
      if (dup.length > 0) { skipped++; continue; }

      await db.insert(schema.raceResults).values({
        raceId,
        riderId: rider.id,
        teamId: team?.id ?? null,
        position: r.position,
        timeSeconds: r.timeSeconds,
        timeGapSeconds: r.timeGapSeconds,
        pointsUci: r.uciPoints,
        dnf: r.dnf,
        dns: r.dns,
      });
      inserted++;

      // Ensure riderDisciplineStats exists
      await db.insert(schema.riderDisciplineStats).values({
        riderId: rider.id,
        discipline,
        ageCategory,
        gender,
        currentElo: "1500",
        eloMean: "1500",
        eloVariance: "350",
        uciPoints: 0,
      }).onConflictDoNothing();
    } catch (err: any) {
      console.error(`    ❌ ${r.riderName}: ${err.message}`);
      errors++;
    }
  }
  return { inserted, skipped, errors };
}

// ─── Main race processor ──────────────────────────────────────────────────────
async function processRace(entry: PCSRaceEntry, browser: Browser, cp: Checkpoint): Promise<void> {
  const pcsUrl = entry.pcsUrl;
  const { ageCategory, gender } = entry.circuit;

  if (cp.completedPcsUrls.includes(pcsUrl)) {
    console.log(`  ⏭️  Already done: ${entry.name}`);
    return;
  }

  console.log(`\n  🔍 ${entry.name} (${entry.date}) [${ageCategory} ${gender}]`);

  if (DRY_RUN) {
    console.log(`  🧪 DRY RUN — would process ${pcsUrl}`);
    cp.completedPcsUrls.push(pcsUrl);
    return;
  }

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" });

  try {
    const raceEventId = await findOrCreateRaceEvent(entry.name, entry.date, "road");
    const stageCount = await detectStages(page, pcsUrl);
    const isStageRace = stageCount > 0;
    const raceType = isStageRace ? "stage_race" : "one_day";

    if (isStageRace) {
      console.log(`  📅 Stage race: ${stageCount} stages`);

      // Create parent GC race
      const { id: gcRaceId, alreadyHasResults } = await findOrCreateRace({
        name: entry.name,
        date: entry.date,
        discipline: "road",
        ageCategory,
        gender,
        raceType: "stage_race",
        uciCategory: entry.uciCategory,
        country: entry.country,
        pcsUrl,
        raceEventId,
      });

      if (!alreadyHasResults) {
        // GC results
        const gcResults = await scrapeResultsPage(page, `${pcsUrl}/gc`);
        if (gcResults.length > 0) {
          const { inserted } = await insertResults(gcRaceId, gcResults, "road", ageCategory, gender);
          console.log(`  ✅ GC: ${inserted} results`);
          if (inserted > 0) {
            await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, gcRaceId));
            const eloUpdates = await processRaceElo(gcRaceId).catch(e => { console.warn(`  ⚠️ TrueSkill failed: ${e.message}`); return 0; });
            console.log(`  🎯 TrueSkill: ${eloUpdates} updates`);
          }
        }
      } else {
        console.log(`  ⏭️  GC results already exist`);
      }

      // Individual stages
      for (let s = 1; s <= stageCount; s++) {
        const stagePcsUrl = `${pcsUrl}/stage-${s}/result`;
        const stageName = `${entry.name} - Stage ${s}`;

        const { id: stageRaceId, alreadyHasResults: stageHasResults } = await findOrCreateRace({
          name: stageName,
          date: entry.date,
          discipline: "road",
          ageCategory,
          gender,
          raceType: "stage_race",
          uciCategory: entry.uciCategory,
          country: entry.country,
          pcsUrl: stagePcsUrl,
          raceEventId,
          parentRaceId: gcRaceId,
          stageNumber: s,
        });

        if (stageHasResults) {
          console.log(`  ⏭️  Stage ${s} already has results`);
          continue;
        }

        const stageResults = await scrapeResultsPage(page, stagePcsUrl, s);
        if (stageResults.length > 0) {
          const { inserted } = await insertResults(stageRaceId, stageResults, "road", ageCategory, gender);
          console.log(`  ✅ Stage ${s}: ${inserted} results`);
          if (inserted > 0) {
            await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, stageRaceId));
            await processRaceElo(stageRaceId).catch(() => {});
          }
        }
      }
    } else {
      // One-day race
      const { id: raceId, alreadyHasResults } = await findOrCreateRace({
        name: entry.name,
        date: entry.date,
        discipline: "road",
        ageCategory,
        gender,
        raceType: "one_day",
        uciCategory: entry.uciCategory,
        country: entry.country,
        pcsUrl,
        raceEventId,
      });

      if (alreadyHasResults) {
        console.log(`  ⏭️  Results already exist`);
        cp.completedPcsUrls.push(pcsUrl);
        saveCheckpoint(cp);
        return;
      }

      const results = await scrapeResultsPage(page, `${pcsUrl}/result`);
      if (results.length > 0) {
        const { inserted, skipped, errors } = await insertResults(raceId, results, "road", ageCategory, gender);
        console.log(`  ✅ ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
        if (inserted > 0) {
          await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, raceId));
          const eloUpdates = await processRaceElo(raceId).catch(e => { console.warn(`  ⚠️ TrueSkill failed: ${e.message}`); return 0; });
          console.log(`  🎯 TrueSkill: ${eloUpdates} updates`);
        }
      } else {
        console.log(`  ⚠️  No results scraped`);
      }
    }

    cp.completedPcsUrls.push(pcsUrl);
    saveCheckpoint(cp);
  } catch (err: any) {
    console.error(`  ❌ Failed ${entry.name}: ${err.message}`);
    cp.failedPcsUrls.push(pcsUrl);
    saveCheckpoint(cp);
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚴 Road 2025 Importer${DRY_RUN ? " [DRY RUN]" : ""}${FRESH ? " [FRESH]" : ""}`);
  console.log("═══════════════════════════════════════");

  const cp = loadCheckpoint();
  console.log(`Checkpoint: ${cp.completedPcsUrls.length} done, ${cp.failedPcsUrls.length} failed`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" });

  try {
    // Discover circuits (including U23 + Junior)
    const circuits = await discoverCircuits(page);
    const toProcess = circuitArg ? circuits.filter(c => c.id === circuitArg) : circuits;
    console.log(`\nProcessing ${toProcess.length} circuit(s)`);

    // Collect all races from all circuits
    const allRaces: PCSRaceEntry[] = [];
    for (const circuit of toProcess) {
      const races = await fetchCircuitRaces(page, circuit);
      allRaces.push(...races);
    }

    // Sort chronologically — TrueSkill must be processed oldest-first!
    allRaces.sort((a, b) => a.date.localeCompare(b.date));

    console.log(`\nTotal races to process: ${allRaces.length}`);
    console.log(`Already completed: ${cp.completedPcsUrls.length}`);
    console.log(`Remaining: ${allRaces.filter(r => !cp.completedPcsUrls.includes(r.pcsUrl)).length}`);

    for (const race of allRaces) {
      await processRace(race, browser, cp);
    }

  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`✅ Done. ${cp.completedPcsUrls.length} races completed, ${cp.failedPcsUrls.length} failed.`);
  console.log("Checkpoint saved to:", CHECKPOINT_FILE);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
