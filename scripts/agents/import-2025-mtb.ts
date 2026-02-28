/**
 * import-2025-mtb.ts
 *
 * Imports all 2025 MTB XCO + XCC race results from XCOdata.com.
 * Covers all categories: Elite, U23, Junior (men + women).
 *
 * Processes races in chronological order (oldest first) so TrueSkill
 * ratings compound correctly.
 *
 * Usage:
 *   tsx scripts/agents/import-2025-mtb.ts [--dry-run] [--fresh] [--race-id N] [--category elite|u23|junior|all]
 *
 * Checkpoint: scripts/agents/import-progress-mtb-2025.json
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
const raceIdArg = args.indexOf("--race-id") !== -1 ? args[args.indexOf("--race-id") + 1] : null;
const catFilter = (args.indexOf("--category") !== -1 ? args[args.indexOf("--category") + 1] : "all") as string;

const CHECKPOINT_FILE = path.resolve(__dirname, "import-progress-mtb-2025.json");
const RATE_LIMIT_MS = 2000;
let lastRequestTime = 0;

// ─── Checkpoint ───────────────────────────────────────────────────────────────
interface CheckpointEntry {
  xcodataId: string;
  category: string; // "elite-men", "elite-women", etc.
}

interface Checkpoint {
  completed: CheckpointEntry[];
  failed: CheckpointEntry[];
}

function loadCheckpoint(): Checkpoint {
  if (!FRESH && fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch { }
  }
  return { completed: [], failed: [] };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf-8");
}

function isCompleted(cp: Checkpoint, xcodataId: string, category: string): boolean {
  return cp.completed.some(e => e.xcodataId === xcodataId && e.category === category);
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface XCOdataRaceEntry {
  xcodataId: string;
  url: string;
  name: string;
  date: string;     // YYYY-MM-DD (from page)
  country: string | null;
  raceClass: string | null; // WC, HC, C1, C2, etc.
  subDiscipline: "xco" | "xcc"; // from name
}

interface CategoryResult {
  categoryLabel: string; // "Men Elite", "Women U23", etc.
  ageCategory: "elite" | "u23" | "junior";
  gender: "men" | "women";
  results: ParsedResult[];
}

interface ParsedResult {
  riderName: string;    // "LASTNAME Firstname" from XCOdata
  nationality: string | null;
  position: number | null;
  timeStr: string | null;
  uciPoints: number | null;
  dnf: boolean;
  dns: boolean;
}

// ─── XCOdata category label mapping ──────────────────────────────────────────
function parseCategoryLabel(label: string): { ageCategory: "elite" | "u23" | "junior"; gender: "men" | "women" } | null {
  const l = label.toLowerCase();
  const isMen = l.includes("men") && !l.includes("women");
  const isWomen = l.includes("women");
  if (!isMen && !isWomen) return null;
  const gender: "men" | "women" = isWomen ? "women" : "men";

  if (l.includes("elite")) return { ageCategory: "elite", gender };
  if (l.includes("u23") || l.includes("under 23")) return { ageCategory: "u23", gender };
  if (l.includes("junior")) return { ageCategory: "junior", gender };
  return null;
}

function isCategoryIncluded(ageCategory: string): boolean {
  if (catFilter === "all") return true;
  return ageCategory === catFilter;
}

// ─── Calendar scraper ─────────────────────────────────────────────────────────
// XCOdata is server-side rendered — use fast HTTP fetch for calendar scan.
// Season filter is broken; 2025 races are in ID range ~6300–8898.
const SCAN_RATE_MS = 250; // Much faster than Playwright rate limit
let lastScanTime = 0;

async function fetchRacePage(id: number): Promise<string | null> {
  const now = Date.now();
  const wait = SCAN_RATE_MS - (now - lastScanTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastScanTime = Date.now();
  try {
    const res = await fetch(`https://www.xcodata.com/race/${id}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function extractRaceInfo(html: string, id: number): XCOdataRaceEntry | null {
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const titleRaw = titleMatch?.[1]?.replace(" | XCODATA", "").trim() || "";
  if (!titleRaw || titleRaw.includes("404")) return null;

  const titleUpper = titleRaw.toUpperCase();
  const isXCO = titleUpper.includes("XCO");
  const isXCC = titleUpper.includes("XCC");
  if (!isXCO && !isXCC) return null;

  // Extract date — look for "DD Mon YYYY" pattern in HTML
  const dateMatch = html.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(202[0-9])/i);
  if (!dateMatch) return null;
  const months: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
  };
  const month = months[dateMatch[2].toLowerCase()];
  if (!month) return null;
  const raceDate = `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2,"0")}`;

  // Only 2025
  if (raceDate < "2025-01-01" || raceDate >= "2026-01-01") return null;

  // Extract country from flag src
  const flagMatch = html.match(/flags\/(?:16|32)\/([A-Z]{2,3})\.png/);
  const country = flagMatch?.[1] || null;

  // Race class
  const raceClass = titleRaw.match(/(WCh|WC|CC|HC|C1|C2|C3|CS|NC|JO)/)?.[1] || null;

  return {
    xcodataId: String(id),
    url: `https://www.xcodata.com/race/${id}/`,
    name: titleRaw,
    date: raceDate,
    country,
    raceClass,
    subDiscipline: isXCC && !isXCO ? "xcc" : "xco",
  };
}

async function fetchCalendar(_page: Page): Promise<XCOdataRaceEntry[]> {
  console.log("  📋 Building 2025 XCOdata race list via HTTP scan...");

  // Step 1: Get World Cup 2025 race IDs to anchor our scan range
  const wcRes = await fetch("https://www.xcodata.com/worldcup/2025", {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  }).catch(() => null);
  const wcHtml = wcRes ? await wcRes.text() : "";
  const wcIds = [...new Set([...wcHtml.matchAll(/href="\/race\/(\d+)\/"/g)].map(m => parseInt(m[1], 10)))];
  console.log(`  World Cup 2025 IDs: ${wcIds.join(", ")}`);

  const wcNums = wcIds.filter(n => n > 0);
  const minId = wcNums.length > 0 ? Math.max(6200, Math.min(...wcNums) - 300) : 6300;
  const maxId = wcNums.length > 0 ? Math.min(...wcNums.filter(n => n > 8000)) + 400 : 8700;

  console.log(`  Scanning IDs ${minId}–${maxId} (${maxId - minId} IDs, step 2, ~${Math.round((maxId-minId)/2*SCAN_RATE_MS/1000)}s)...`);

  const result: XCOdataRaceEntry[] = [];
  let scanned = 0;
  let reached2026 = false;

  for (let id = minId; id <= maxId && !reached2026; id += 2) {
    scanned++;
    if (scanned % 100 === 0) process.stdout.write(`  Scanned ${scanned} IDs, found ${result.length} races...`);

    const html = await fetchRacePage(id);
    if (!html) continue;

    if (html.includes("404 error") || html.includes("page doesn't exist")) continue;

    // Check if we've hit 2026 races (stop scanning)
    const yearMatch = html.match(/(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(202[0-9])/i);
    if (yearMatch && parseInt(yearMatch[2]) >= 2026) {
      console.log(`
  Reached 2026 at ID ${id}, stopping`);
      reached2026 = true;
      break;
    }

    const entry = extractRaceInfo(html, id);
    if (entry) result.push(entry);
  }

  // Also scan the late-2025 range separately (8400–8900) which the WC IDs anchor
  if (!reached2026 && wcNums.some(n => n > 8000)) {
    const lateMin = Math.max(8200, Math.min(...wcNums.filter(n => n > 8000)) - 300);
    const lateMax = Math.min(8900, Math.max(...wcNums.filter(n => n > 8000)) + 400);
    console.log(`
  Late-season scan: IDs ${lateMin}–${lateMax}...`);
    for (let id = lateMin; id <= lateMax; id += 2) {
      const html = await fetchRacePage(id);
      if (!html || html.includes("404 error")) continue;
      const entry = extractRaceInfo(html, id);
      if (entry) {
        if (!result.find(r => r.xcodataId === entry.xcodataId)) {
          result.push(entry);
        }
      }
    }
  }

  // Deduplicate and sort chronologically
  const unique = [...new Map(result.map(r => [r.xcodataId, r])).values()];
  unique.sort((a, b) => a.date.localeCompare(b.date));

  console.log(`
  Total 2025 XCO+XCC races found: ${unique.length}`);
  return unique;
}

// ─── Race page scraper ────────────────────────────────────────────────────────
function parseXCOdataTime(str: string): number | null {
  if (!str || str.trim() === "" || str.trim() === "-") return null;
  const clean = str.trim().replace(/[^0-9:]/g, "");
  const parts = clean.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// XCOdata tab pane IDs encode category:
// XCO_ME, XCO_WE, XCO_MU, XCO_WU, XCO_MJ, XCO_WJ
// XCC_ME, XCC_WE, etc.
const XCODATA_PANE_MAP: Record<string, { ageCategory: "elite" | "u23" | "junior"; gender: "men" | "women" }> = {
  "_ME": { ageCategory: "elite",  gender: "men"   },
  "_WE": { ageCategory: "elite",  gender: "women" },
  "_MU": { ageCategory: "u23",    gender: "men"   },
  "_WU": { ageCategory: "u23",    gender: "women" },
  "_MJ": { ageCategory: "junior", gender: "men"   },
  "_WJ": { ageCategory: "junior", gender: "women" },
};

async function scrapeRacePage(page: Page, entry: XCOdataRaceEntry): Promise<{
  date: string | null;
  country: string | null;
  categories: CategoryResult[];
}> {
  await rateLimit();
  console.log(`  📄 ${entry.name} → ${entry.url}`);
  try {
    await page.goto(entry.url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
  } catch (err: any) {
    console.error(`  ❌ Load failed: ${err.message}`);
    return { date: null, country: null, categories: [] };
  }

  // Dismiss cookie consent via JS (blocks clicks otherwise)
  await page.evaluate(() => {
    const overlay = document.querySelector(".fc-consent-root, .fc-dialog-overlay, [class*='consent']") as HTMLElement | null;
    if (overlay) overlay.style.display = "none";
    const root = document.querySelector(".fc-consent-root") as HTMLElement | null;
    if (root) root.remove();
  }).catch(() => {});

  // Click all "View full results" links via JS (bypasses overlay)
  await page.evaluate(() => {
    document.querySelectorAll("a").forEach(a => {
      if (a.textContent?.toLowerCase().includes("full results")) {
        (a as HTMLAnchorElement).click();
      }
    });
  }).catch(() => {});
  await page.waitForTimeout(800);

  // Get race metadata
  const meta = await page.evaluate(() => {
    const infoItems = Array.from(document.querySelectorAll(".race-info li, .card-body li, .list-group-item, .col-md-6 li"));
    const dateText = infoItems.find(el => /\d{1,2}\s+\w+\s+\d{4}/.test(el.textContent ?? ""))?.textContent?.trim() ?? "";
    const flagImg = document.querySelector(".race-header img[src*='flags'], h1 ~ * img[src*='flags'], .card img[src*='flags']") as HTMLImageElement | null;
    const country = flagImg?.alt || flagImg?.src?.match(/\/([A-Z]{2,3})\.png/i)?.[1]?.toUpperCase() || null;
    return { dateText, country };
  }).catch(() => ({ dateText: "", country: null }));

  // Parse all tab panes directly from DOM — no tab clicking needed!
  const allPaneData = await page.evaluate(() => {
    const results: {
      paneId: string;
      rows: { pos: string; riderName: string; riderSlug: string; nat: string | null; timeStr: string; uciPts: string }[];
    }[] = [];

    // Find all tab panes with result tables
    const panes = Array.from(document.querySelectorAll(".tab-pane[id^='results_']")) as HTMLElement[];
    
    for (const pane of panes) {
      const paneId = pane.id; // e.g. "results_XCO_ME"
      const table = pane.querySelector("table.table") as HTMLTableElement | null;
      if (!table) continue;

      const rows: typeof results[0]["rows"] = [];
      table.querySelectorAll("tbody tr").forEach(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 2) return;
        
        const riderLink = tr.querySelector("a[href*='/rider/']") as HTMLAnchorElement | null;
        if (!riderLink) return;
        
        const riderName = riderLink.textContent?.trim() ?? "";
        if (!riderName) return;
        
        const riderSlug = (riderLink.getAttribute("href") ?? "").replace(/^\/rider\//, "").replace(/\/$/, "");
        
        // Nationality from flag img
        const flag = tr.querySelector("img[src*='flags']") as HTMLImageElement | null;
        const nat = flag?.alt || flag?.src?.match(/\/([A-Z]{2,3})\.png/i)?.[1]?.toUpperCase() || null;
        
        // Position (first cell)
        const posEl = tds[0]?.querySelector(".circle, .pos-circle") as HTMLElement | null;
        const pos = posEl?.textContent?.trim() || tds[0]?.textContent?.trim().replace(/[^0-9DNFSQ]+/g, "") || "";
        
        // Result cell (last cell): contains time + UCI points
        const resultText = tds[tds.length - 1]?.textContent?.trim() ?? "";
        // Time pattern: "1:04:48" or "24:31"
        const timeMatch = resultText.match(/\d+:\d+:\d+|\d+:\d+/);
        const timeStr = timeMatch?.[0] || "";
        // Points pattern: "20 Pts"
        const ptsMatch = resultText.match(/(\d+)\s*Pts?/i);
        const uciPts = ptsMatch?.[1] || "";
        
        rows.push({ pos, riderName, riderSlug, nat, timeStr, uciPts });
      });
      
      if (rows.length > 0) {
        results.push({ paneId, rows });
      }
    }
    return results;
  });

  const categories: CategoryResult[] = [];

  for (const paneData of allPaneData) {
    // Map pane ID to category: "results_XCO_ME" → suffix "_ME"
    const suffix = Object.keys(XCODATA_PANE_MAP).find(s => paneData.paneId.endsWith(s));
    if (!suffix) continue;
    
    const catInfo = XCODATA_PANE_MAP[suffix];
    if (!isCategoryIncluded(catInfo.ageCategory)) continue;

    const parsedResults: ParsedResult[] = paneData.rows.map(r => {
      const posUp = r.pos.toUpperCase().trim();
      const dnf = posUp === "DNF";
      const dns = posUp === "DNS" || posUp === "DSQ";
      const position = (!dnf && !dns && /^\d+$/.test(posUp)) ? parseInt(posUp, 10) : null;
      const uciPoints = r.uciPts ? parseInt(r.uciPts, 10) || null : null;
      return {
        riderName: r.riderName,
        nationality: r.nat,
        position,
        timeStr: r.timeStr || null,
        uciPoints,
        dnf,
        dns,
      };
    }).filter(r => r.riderName.length > 1);

    if (parsedResults.length > 0) {
      const labelMap: Record<string, string> = {
        "_ME": "Men Elite", "_WE": "Women Elite",
        "_MU": "Men U23",   "_WU": "Women U23",
        "_MJ": "Men Junior", "_WJ": "Women Junior",
      };
      console.log(`    📊 ${labelMap[suffix] || suffix}: ${parsedResults.length} results`);
      categories.push({
        categoryLabel: labelMap[suffix] || suffix,
        ageCategory: catInfo.ageCategory,
        gender: catInfo.gender,
        results: parsedResults,
      });
    }
  }

  // Parse date
  let date: string | null = entry.date;
  if (meta.dateText) {
    try {
      const d = new Date(meta.dateText);
      if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
    } catch {}
  }

  return { date, country: meta.country, categories };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function findOrCreateRaceEvent(entry: XCOdataRaceEntry): Promise<string> {
  // Match by name + discipline + year
  const existing = await db.query.raceEvents.findFirst({
    where: and(
      eq(schema.raceEvents.name, entry.name),
      eq(schema.raceEvents.discipline, "mtb")
    ),
  });
  if (existing) return existing.id;

  const slug = slugify(entry.name) + "-" + entry.date.substring(0, 4);
  const [created] = await db.insert(schema.raceEvents).values({
    name: entry.name,
    slug,
    date: entry.date,
    discipline: "mtb",
    subDiscipline: entry.subDiscipline,
    country: entry.country?.slice(0, 3) ?? null,
    series: entry.raceClass?.toLowerCase() ?? null,
    sourceType: "xcodata",
    sourceUrl: entry.url,
  }).returning({ id: schema.raceEvents.id });
  return created.id;
}

async function findOrCreateMTBRace(opts: {
  name: string;
  date: string;
  discipline: string;
  subDiscipline: string;
  ageCategory: string;
  gender: string;
  country: string | null;
  raceEventId: string;
  xcodataUrl: string;
}): Promise<{ id: string; alreadyHasResults: boolean }> {
  // Match by raceEventId + ageCategory + gender
  const existing = await db.query.races.findFirst({
    where: and(
      eq(schema.races.raceEventId, opts.raceEventId),
      eq(schema.races.ageCategory, opts.ageCategory),
      eq(schema.races.gender, opts.gender),
    ),
  });

  if (existing) {
    const cnt = await db.select({ c: sql<number>`count(*)` }).from(schema.raceResults).where(eq(schema.raceResults.raceId, existing.id));
    return { id: existing.id, alreadyHasResults: (cnt[0]?.c ?? 0) > 0 };
  }

  const catSlug = `${opts.ageCategory}-${opts.gender}`;
  const [created] = await db.insert(schema.races).values({
    name: `${opts.name} - ${catSlug}`,
    categorySlug: catSlug,
    date: opts.date,
    discipline: opts.discipline,
    raceType: opts.subDiscipline,
    ageCategory: opts.ageCategory,
    gender: opts.gender,
    country: opts.country?.slice(0, 3) ?? null,
    raceEventId: opts.raceEventId,
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
      const rider = await findOrCreateRider({
        name: r.riderName,
        nationality: r.nationality,
      });

      const dup = await db.select({ id: schema.raceResults.id })
        .from(schema.raceResults)
        .where(and(eq(schema.raceResults.raceId, raceId), eq(schema.raceResults.riderId, rider.id)))
        .limit(1);
      if (dup.length > 0) { skipped++; continue; }

      const timeSeconds = r.timeStr ? parseXCOdataTime(r.timeStr) : null;
      await db.insert(schema.raceResults).values({
        raceId,
        riderId: rider.id,
        teamId: null,
        position: r.position,
        timeSeconds,
        timeGapSeconds: null, // XCOdata doesn't always have gaps
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
        uciPoints: r.uciPoints ?? 0,
      }).onConflictDoNothing();
    } catch (err: any) {
      console.error(`    ❌ ${r.riderName}: ${err.message}`);
      errors++;
    }
  }
  return { inserted, skipped, errors };
}

// ─── Main race processor ──────────────────────────────────────────────────────
async function processRace(entry: XCOdataRaceEntry, browser: Browser, cp: Checkpoint): Promise<void> {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    const { date, country, categories } = await scrapeRacePage(page, entry);
    if (categories.length === 0) {
      console.log(`  ⚠️  No categories found for ${entry.name}`);
      return;
    }

    const raceDate = date ?? entry.date;

    // Only process 2025 races — skip anything in 2026+
    if (raceDate && raceDate >= '2026-01-01') {
      console.log(`  ⏭️  Skipping 2026 race: ${entry.name} (${raceDate})`);
      // Mark as completed in checkpoint so we don't retry
      for (const catKey of ['elite-men','elite-women','u23-men','u23-women','junior-men','junior-women']) {
        if (!isCompleted(cp, entry.xcodataId, catKey)) {
          cp.completed.push({ xcodataId: entry.xcodataId, category: catKey });
        }
      }
      saveCheckpoint(cp);
      return;
    }

    const raceEventId = await findOrCreateRaceEvent({ ...entry, date: raceDate, country: country ?? entry.country });

    for (const cat of categories) {
      const catKey = `${cat.ageCategory}-${cat.gender}`;
      if (isCompleted(cp, entry.xcodataId, catKey)) {
        console.log(`  ⏭️  ${catKey} already done`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  🧪 DRY RUN — ${catKey}: ${cat.results.length} results`);
        cp.completed.push({ xcodataId: entry.xcodataId, category: catKey });
        continue;
      }

      const { id: raceId, alreadyHasResults } = await findOrCreateMTBRace({
        name: entry.name,
        date: raceDate,
        discipline: "mtb",
        subDiscipline: entry.subDiscipline,
        ageCategory: cat.ageCategory,
        gender: cat.gender,
        country: country ?? entry.country,
        raceEventId,
        xcodataUrl: entry.url,
      });

      if (alreadyHasResults) {
        console.log(`  ⏭️  ${catKey} already has results`);
        cp.completed.push({ xcodataId: entry.xcodataId, category: catKey });
        saveCheckpoint(cp);
        continue;
      }

      const { inserted, skipped, errors } = await insertResults(raceId, cat.results, "mtb", cat.ageCategory, cat.gender);
      console.log(`  ✅ ${catKey}: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);

      if (inserted > 0) {
        await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, raceId));
        const eloUpdates = await processRaceElo(raceId).catch(e => { console.warn(`  ⚠️ TrueSkill: ${e.message}`); return 0; });
        console.log(`  🎯 TrueSkill: ${eloUpdates} updates`);
      }

      cp.completed.push({ xcodataId: entry.xcodataId, category: catKey });
      saveCheckpoint(cp);
    }
  } catch (err: any) {
    console.error(`  ❌ Failed ${entry.name}: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚵 MTB 2025 Importer (XCO+XCC)${DRY_RUN ? " [DRY RUN]" : ""}${FRESH ? " [FRESH]" : ""}`);
  console.log("═══════════════════════════════════════");

  const cp = loadCheckpoint();
  console.log(`Checkpoint: ${cp.completed.length} done, ${cp.failed.length} failed`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" });

  try {
    let races: XCOdataRaceEntry[];

    if (raceIdArg) {
      // Single race mode
      races = [{
        xcodataId: raceIdArg,
        url: `https://www.xcodata.com/race/${raceIdArg}/`,
        name: `Race ${raceIdArg}`,
        date: "2025-01-01",
        country: null,
        raceClass: null,
        subDiscipline: "xco",
      }];
    } else {
      races = await fetchCalendar(page);
    }

    // Sort chronologically — TrueSkill must be oldest-first!
    races.sort((a, b) => a.date.localeCompare(b.date));

    const remaining = races.filter(r => {
      const cats = ["elite-men", "elite-women", "u23-men", "u23-women", "junior-men", "junior-women"];
      return cats.some(c => !isCompleted(cp, r.xcodataId, c));
    });

    console.log(`\nTotal races: ${races.length}`);
    console.log(`Remaining: ${remaining.length}`);

    for (const race of races) {
      console.log(`\n🏁 ${race.name} (${race.date}) [${race.subDiscipline.toUpperCase()}] — id:${race.xcodataId}`);
      await processRace(race, browser, cp);
    }

  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`✅ Done. ${cp.completed.length} category-races completed, ${cp.failed.length} failed.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
