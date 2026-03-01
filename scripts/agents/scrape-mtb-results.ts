/**
 * MTB Results Scraper
 *
 * Scrapes XCO/XCC race results from xcodata.com for MTB discipline races.
 * XCOdata race IDs are sequential (e.g. /race/9230/); we discover them from
 * the /races list page, matching by name and date vicinity.
 *
 * Usage:
 *   tsx scripts/agents/scrape-mtb-results.ts [--race-id <uuid>] [--days <n>] [--dry-run] [--force]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, or, isNull, ne } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";
/** Fetch XCOdata pages directly — no Cloudflare, no scrape.do needed */
async function fetchXCO(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch (e: any) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 3000));
      return fetchXCO(url, attempt + 1);
    }
    throw e;
  }
}
import { spawn } from "child_process";
import { processRaceElo } from "../../src/lib/prediction/process-race-elo";
import { writeScrapeStatus, type RaceRow } from "./lib/scrape-status";
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

// ─── XCOdata category mapping ─────────────────────────────────────────────────
// XCOdata table anchors: #laps-N-XCO_ME, XCO_WE, XCO_MU, XCO_WU, XCO_MJ, XCO_WJ
// Also XCC variants

const CAT_MAP: Record<string, { ageCategory: string; gender: string }> = {
  XCO_ME: { ageCategory: "elite",  gender: "men" },
  XCO_WE: { ageCategory: "elite",  gender: "women" },
  XCO_MU: { ageCategory: "u23",    gender: "men" },
  XCO_WU: { ageCategory: "u23",    gender: "women" },
  XCO_MJ: { ageCategory: "junior", gender: "men" },
  XCO_WJ: { ageCategory: "junior", gender: "women" },
  XCC_ME: { ageCategory: "elite",  gender: "men" },
  XCC_WE: { ageCategory: "elite",  gender: "women" },
  XCC_MU: { ageCategory: "u23",    gender: "men" },
  XCC_WU: { ageCategory: "u23",    gender: "women" },
  XCC_MJ: { ageCategory: "junior", gender: "men" },
  XCC_WJ: { ageCategory: "junior", gender: "women" },
};

function catKey(ageCategory: string, gender: string, raceType = "xco"): string {
  const type = raceType.toUpperCase();
  const ag = ageCategory === "elite" ? "E" : ageCategory === "u23" ? "U" : "J";
  const gn = gender === "men" ? "M" : "W";
  return `${type}_${gn}${ag}`;
}

// ─── XCOdata race list cache ───────────────────────────────────────────────────

interface XCOListEntry {
  xcoId: string;
  name: string;
  date: string; // YYYY-MM-DD
}

let xcoListCache: XCOListEntry[] | null = null;

function parseXCODate(raw: string): string {
  // "21 - 22 Feb 2026" → take last date; "07 Feb 2026" → direct
  const clean = raw.trim().replace(/.*-\s*/, "").trim();
  const m = clean.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return "";
  const months: Record<string, string> = {
    Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
    Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"
  };
  const mm = months[m[2]] ?? "01";
  return `${m[3]}-${mm}-${m[1].padStart(2,"0")}`;
}

async function getXCORaceList(): Promise<XCOListEntry[]> {
  if (xcoListCache) return xcoListCache;
  console.log("   📋 Fetching XCOdata race list…");
  let html: string;
  try {
    html = await fetchXCO("https://www.xcodata.com/races");
  } catch (e: any) {
    console.error("   ❌ Failed to fetch XCOdata race list:", e.message);
    return [];
  }
  const $ = cheerio.load(html);
  const entries: XCOListEntry[] = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const dateRaw = cells.eq(0).text().trim();
    const date = parseXCODate(dateRaw);
    if (!date) return;
    const link = $(row).find("a[href*='/race/']").first();
    const href = link.attr("href") || "";
    const xcoId = href.match(/\/race\/(\d+)\//)?.[1] || "";
    const name = link.text().trim();
    if (xcoId && name && date) entries.push({ xcoId, name, date });
  });
  console.log(`   📋 Found ${entries.length} XCOdata races`);
  xcoListCache = entries;
  return entries;
}

// ─── Fuzzy race name matching ─────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCategorySuffix(name: string): string {
  return name.replace(/\s*[-–|]\s*(elite|u23|under 23|junior|men|women|masculin|feminin).*$/i, "").trim();
}

async function findXCORaceId(race: { name: string; date: string; raceType: string | null }): Promise<string | null> {
  const list = await getXCORaceList();
  const cleanName = normalizeForMatch(stripCategorySuffix(race.name));
  const raceDate = race.date.substring(0, 10);

  // Window: ±3 days around race date
  const raceDateMs = new Date(raceDate).getTime();

  let best: { xcoId: string; score: number } | null = null;

  for (const entry of list) {
    const entryMs = new Date(entry.date).getTime();
    const daysDiff = Math.abs((entryMs - raceDateMs) / 86400000);
    if (daysDiff > 3) continue;

    const entryName = normalizeForMatch(entry.name);

    // Token overlap score
    const raceTokens = new Set(cleanName.split(" ").filter(t => t.length > 2));
    const entryTokens = new Set(entryName.split(" ").filter(t => t.length > 2));
    let overlap = 0;
    for (const t of raceTokens) if (entryTokens.has(t)) overlap++;
    const score = overlap / Math.max(raceTokens.size, 1) * (1 - daysDiff * 0.05);

    if (score > 0.4 && (!best || score > best.score)) {
      best = { xcoId: entry.xcoId, score };
    }
  }

  if (best) {
    console.log(`   🔗 Matched XCOdata race ID: ${best.xcoId} (score: ${best.score.toFixed(2)})`);
    return best.xcoId;
  }
  return null;
}

// ─── Parse XCOdata results page ───────────────────────────────────────────────

interface XCOResult {
  position: number | null;
  riderName: string;
  timeSeconds: number | null;
  dnf: boolean;
  dns: boolean;
  catCode: string; // e.g. XCO_ME
}

function parseXCOTime(raw: string): number | null {
  // "1:22:00 100 Pts" → extract time portion
  const timeOnly = raw.replace(/\d+\s*Pts.*$/i, "").trim();
  if (!timeOnly || timeOnly === "-") return null;
  const parts = timeOnly.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseXCORiderName(raw: string): string {
  // "KORETZKY Victor SPECIALIZED FACTORY RACING" — team appended in uppercase
  // Strategy: take words until we hit an all-caps run that looks like a team name
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Split on first occurrence of 2+ consecutive all-caps words that aren't part of the name
  // Names are: "LASTNAME Firstname" or "LASTNAME COMPOUND Firstname"
  // Teams are usually 2+ words all caps after the first name
  const words = cleaned.split(" ");
  // Find first-name position: first word with mixed case after initial all-caps word
  let nameEnd = words.length;
  let foundFirstName = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!foundFirstName && /^[A-Z][a-z]/.test(w)) {
      foundFirstName = true;
      nameEnd = i + 1;
    } else if (foundFirstName && /^[A-Z]{2,}/.test(w)) {
      nameEnd = i;
      break;
    }
  }
  return words.slice(0, nameEnd).join(" ");
}

// Cache scraped pages per xcoId to avoid re-fetching for each category of the same event
const xcoPageCache = new Map<string, string>();

async function scrapeXCORaceResults(xcoId: string, attempt = 1): Promise<XCOResult[]> {
  const url = `https://www.xcodata.com/race/${xcoId}/`;

  let html = xcoPageCache.get(xcoId) ?? "";
  if (!html) {
    console.log(`   📄 Fetching XCOdata: ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
    try {
      html = await fetchXCO(url);
      xcoPageCache.set(xcoId, html);
    } catch (e: any) {
      if (attempt < 3) {
        console.warn(`   ⚠️  Failed, retrying in ${attempt * 5}s: ${e.message}`);
        await sleep(attempt * 5000);
        return scrapeXCORaceResults(xcoId, attempt + 1);
      }
      console.error(`   ❌ Failed after ${attempt} attempts: ${e.message}`);
      return [];
    }
  } else {
    console.log(`   📄 Using cached page for XCO race ${xcoId}`);
  }

  const $ = cheerio.load(html);
  const results: XCOResult[] = [];

  $("table").each((_, tbl) => {
    // Category encoded in row link hrefs: <a href="#laps-1-XCO_ME">
    let catCode = "";
    $(tbl).find("a[href]").each((_, el) => {
      if (catCode) return;
      const href = $(el).attr("href") || "";
      const m = href.match(/#laps-\d+-(XC[CO]_\w+)/);
      if (m) catCode = m[1];
    });
    if (!catCode) return; // skip info/metadata tables

    $(tbl).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const posText = cells.eq(0).text().trim();
      if (!posText || posText.toLowerCase() === "rank") return;
      const riderRaw = cells.eq(1).text().replace(/\s+/g, " ").trim();
      const riderName = parseXCORiderName(riderRaw);
      if (!riderName || riderName.toLowerCase() === "rider") return;
      const resultRaw = cells.eq(2)?.text().replace(/\s+/g, " ").trim() ?? "";
      const posUp = posText.toUpperCase();
      const isDnf = posUp === "DNF" || resultRaw.toUpperCase().includes("DNF");
      const isDns = posUp === "DNS" || resultRaw.toUpperCase().includes("DNS");
      const position = isDnf || isDns ? null : parseInt(posText, 10) || null;
      const timeSeconds = isDnf || isDns ? null : parseXCOTime(resultRaw);
      results.push({ position, riderName, timeSeconds, dnf: isDnf, dns: isDns, catCode });
    });
  });

  const catSummary = [...new Set(results.map(r => r.catCode))]
    .map(c => `${c}:${results.filter(r => r.catCode === c).length}`).join(", ");
  console.log(`   ✅ Parsed ${results.length} results${catSummary ? ` (${catSummary})` : ""}`);
  return results;
}

// ─── DB helpers (shared with scrape-results.ts) ────────────────────────────────

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

async function importMTBResults(
  raceId: string,
  results: XCOResult[],
  ageCategory: string,
  gender: string
): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0, skipped = 0, errors = 0;

  // Bulk-check existing
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
      await db.insert(schema.riderDisciplineStats).values({
        riderId, discipline: "mtb", ageCategory, gender,
        currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
      }).onConflictDoNothing();
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
}

async function processRace(race: DBRace): Promise<{ inserted: number; status: string }> {
  const xcoId = await findXCORaceId(race);
  if (!xcoId) {
    console.log(`   ⏭️  No XCOdata match found`);
    return { inserted: 0, status: "no-xco-match" };
  }

  const allResults = await scrapeXCORaceResults(xcoId);
  if (allResults.length === 0) {
    return { inserted: 0, status: "no-results-yet" };
  }

  // Filter to this race's category
  const raceType = (race.raceType ?? "xco").toUpperCase().includes("XCC") ? "XCC" : "XCO";
  const key = catKey(race.ageCategory, race.gender, raceType);
  const catResults = allResults.filter(r => r.catCode === key);

  if (catResults.length === 0) {
    // Fallback: if we only got one category set, use all results
    const uniqueCats = [...new Set(allResults.map(r => r.catCode))];
    console.log(`   ⚠️  No results for category ${key}. Available: ${uniqueCats.join(", ")}`);
    if (uniqueCats.length === 1) {
      // Use whatever was parsed
    } else {
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

  const { inserted, skipped, errors } = await importMTBResults(race.id, toImport, race.ageCategory, race.gender);

  if (inserted > 0) {
    await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, race.id));
    try {
      const eloUpdates = await processRaceElo(race.id);
      console.log(`   🎯 ELO: ${eloUpdates} rider ratings updated`);
    } catch (e: any) {
      console.warn(`   ⚠️  ELO update failed: ${e.message}`);
    }

    // Fire-and-forget: predictions refresh + marketing (non-blocking)
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

  let races: DBRace[];

  if (raceIdArg) {
    const r = await db.query.races.findFirst({ where: eq(schema.races.id, raceIdArg) });
    if (!r || r.discipline !== "mtb") { console.log("Race not found or not MTB"); return; }
    races = [{ id: r.id, name: r.name, date: r.date, ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men", raceType: r.raceType ?? null, status: r.status ?? null }];
  } else {
    const notCompleted = or(isNull(schema.races.status), ne(schema.races.status, "completed"));
    const statusFilter = force ? undefined : notCompleted;
    const rows = await db.select({
      id: schema.races.id, name: schema.races.name, date: schema.races.date,
      ageCategory: schema.races.ageCategory, gender: schema.races.gender,
      raceType: schema.races.raceType, status: schema.races.status,
    })
    .from(schema.races)
    .where(and(
      eq(schema.races.discipline, "mtb"),
      gte(schema.races.date, pastDate),
      lte(schema.races.date, today),
      ...(statusFilter ? [statusFilter] : []),
    ));
    races = rows.map(r => ({
      ...r, ageCategory: r.ageCategory ?? "elite", gender: r.gender ?? "men",
      raceType: r.raceType ?? null, status: r.status ?? null,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  if (races.length === 0) {
    console.log("No MTB races needing results.");
    return;
  }

  console.log(`Found ${races.length} MTB race(s)\n`);
  races.forEach(r => console.log(`  • ${r.name} (${r.date})`));
  console.log();

  const raceRows: RaceRow[] = [];
  let totalInserted = 0;

  for (const race of races) {
    console.log(`\n🔍 ${race.name} (${race.date})`);
    const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
    const { inserted, status } = await processRace(race);
    totalInserted += inserted;

    const statusEmoji =
      status === "imported" ? "✅ imported" :
      status === "already-done" ? "✅ already done" :
      status === "no-results-yet" ? "⏳ pending" :
      status === "no-xco-match" ? "⚠️ no XCO match" :
      status === "no-cat-match" ? "⚠️ category mismatch" :
      status === "incomplete" ? "⚠️ incomplete" :
      status === "dry-run" ? "🔍 dry-run" : "❌ error";

    raceRows.push({ name: race.name, date: race.date, count: inserted, status: statusEmoji, scrapedAt: now });
    if (races.indexOf(race) < races.length - 1) await sleep(2000);
  }

  writeScrapeStatus({
    component: "mtb-results",
    status: totalInserted > 0 ? "ok" : "warn",
    summary: `${totalInserted} MTB results imported across ${races.length} race(s).`,
    raceRows,
  });

  console.log("\n─────────────────────────────");
  console.log(`Total: ${totalInserted} MTB results imported`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
