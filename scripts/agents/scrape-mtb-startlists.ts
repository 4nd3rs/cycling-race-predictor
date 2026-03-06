/**
 * MTB Startlist & Results Scraper
 * Supports: sportstiming.dk | my.raceresult.com | xcodata.com
 *
 * Flow:
 *   1. Find upcoming/recent MTB race_events with a known timing_system
 *   2. Fetch startlists (pre-race) and/or results (post-race) per category
 *   3. Upsert riders + race_startlist rows, mark race completed when results arrive
 *
 * Usage:
 *   tsx scripts/agents/scrape-mtb-startlists.ts [--event-id <uuid>] [--days <n>] [--ahead <n>] [--dry-run] [--results-only] [--startlist-only]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const eventIdArg    = getArg("event-id");
const daysBack      = parseInt(getArg("days", "3"), 10);
const daysAhead     = parseInt(getArg("ahead", "14"), 10);
const dryRun        = args.includes("--dry-run");
const resultsOnly   = args.includes("--results-only");
const startlistOnly = args.includes("--startlist-only");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function fetchHTML(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (e: any) {
    if (attempt < 3) { await sleep(attempt * 3000); return fetchHTML(url, attempt + 1); }
    throw e;
  }
}

async function fetchJSON<T>(url: string, attempt = 1): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json() as Promise<T>;
  } catch (e: any) {
    if (attempt < 3) { await sleep(attempt * 2000); return fetchJSON<T>(url, attempt + 1); }
    throw e;
  }
}

// ─── Category classifier ──────────────────────────────────────────────────────
interface CategoryMatch { ageCategory: "elite" | "u23" | "junior"; gender: "men" | "women" }

const CATEGORY_PATTERNS: Array<{ re: RegExp; match: CategoryMatch }> = [
  { re: /elite.*(men|herr|herre|mænd|man\b)|men.*elite|herrer.*elite/i,        match: { ageCategory: "elite",  gender: "men" } },
  { re: /elite.*(wom[ae]n|dam|kvind|ladies)|wom[ae]n.*elite|damer.*elite/i,    match: { ageCategory: "elite",  gender: "women" } },
  { re: /u23.*(men|herr)|men.*u23|under.?23.*men|under.?23.*herr/i,            match: { ageCategory: "u23",    gender: "men" } },
  { re: /u23.*(wom[ae]n|dam)|wom[ae]n.*u23|under.?23.*dam/i,                   match: { ageCategory: "u23",    gender: "women" } },
  { re: /junior.*(men|herr|dreng)|men.*junior|junior.*m[ae]n/i,                match: { ageCategory: "junior", gender: "men" } },
  { re: /junior.*(wom[ae]n|dam|pige)|wom[ae]n.*junior|junior.*wom[ae]n/i,      match: { ageCategory: "junior", gender: "women" } },
  // UCI format: "XCO Men Elite" / "XCO Women Under 23" etc.
  { re: /\bmen\b.*\belite\b|\belite\b.*\bmen\b/i,                              match: { ageCategory: "elite",  gender: "men" } },
  { re: /\bwom[ae]n\b.*\belite\b|\belite\b.*\bwom[ae]n\b/i,                   match: { ageCategory: "elite",  gender: "women" } },
  { re: /\bmen\b.*\bunder\s?23\b|\bunder\s?23\b.*\bmen\b/i,                   match: { ageCategory: "u23",    gender: "men" } },
  { re: /\bwom[ae]n\b.*\bunder\s?23\b|\bunder\s?23\b.*\bwom[ae]n\b/i,        match: { ageCategory: "u23",    gender: "women" } },
  { re: /\bmen\b.*\bjunior\b|\bjunior\b.*\bmen\b/i,                           match: { ageCategory: "junior", gender: "men" } },
  { re: /\bwom[ae]n\b.*\bjunior\b|\bjunior\b.*\bwom[ae]n\b/i,                match: { ageCategory: "junior", gender: "women" } },
];

function classifyCategory(name: string): CategoryMatch | null {
  for (const { re, match } of CATEGORY_PATTERNS) {
    if (re.test(name)) return match;
  }
  return null;
}

// ─── Name normalizer ──────────────────────────────────────────────────────────
function normalizeName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  // UCI format: LASTNAME Firstname → first all-caps token is last name
  if (/^[A-Z][A-Z\-]+$/.test(parts[0])) {
    const lastName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
    const firstName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    return { firstName, lastName };
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

// ─── Rider upsert ─────────────────────────────────────────────────────────────
async function upsertRider(rawName: string, nationality?: string): Promise<string | null> {
  const { firstName, lastName } = normalizeName(rawName);
  if (!lastName) return null;

  const existing = await db.query.riders.findFirst({
    where: and(eq(schema.riders.firstName, firstName), eq(schema.riders.lastName, lastName)),
  });
  if (existing) return existing.id;

  const [created] = await db.insert(schema.riders).values({
    firstName, lastName, nationality: nationality ?? null, discipline: "mtb",
  }).returning({ id: schema.riders.id });
  return created.id;
}

// ─── Race lookup ──────────────────────────────────────────────────────────────
async function findRace(raceEventId: string, ageCategory: string, gender: string) {
  return db.query.races.findFirst({
    where: and(
      eq(schema.races.raceEventId, raceEventId),
      eq(schema.races.ageCategory, ageCategory),
      eq(schema.races.gender, gender),
      eq(schema.races.discipline, "mtb"),
    ),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER: Sportstiming
// ═══════════════════════════════════════════════════════════════════════════════

interface SportstimingCat { id: string; name: string; match: CategoryMatch | null }

function parseSportstimingCategories(html: string): SportstimingCat[] {
  const $ = cheerio.load(html);
  const cats: SportstimingCat[] = [];
  $(".selectDistance option").each((_, el) => {
    const val = $(el).val() as string;
    const name = $(el).text().trim();
    if (!val || val.startsWith("d")) return;
    cats.push({ id: val, name, match: classifyCategory(name) });
  });
  return cats;
}

function parseSportstimingResults(html: string): Array<{ position: number; bib: string; name: string; time: string; country?: string }> {
  const $ = cheerio.load(html);
  const results: Array<{ position: number; bib: string; name: string; time: string; country?: string }> = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;
    const pos = parseInt($(cells[0]).text().trim(), 10);
    if (isNaN(pos)) return;
    const bib = $(cells[1]).text().trim();
    const time = $(cells[2]).text().trim();
    const nameEl = $(cells[3]).find("a[href*='/results/']");
    const name = nameEl.find("span").last().text().trim() || nameEl.text().trim();
    if (!name) return;
    const country = $(cells[3]).find("img").attr("title") || undefined;
    results.push({ position: pos, bib, name, time, country });
  });
  return results;
}

function parseTotalPages(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $("ul.pagination li a").each((_, el) => {
    const n = parseInt($(el).text().trim(), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}

async function fetchSportstimingParticipants(stId: string, distId: string) {
  const url = `https://www.sportstiming.dk/event/${stId}/participants?distance=${distId}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const entries: Array<{ bib: string; name: string; country?: string }> = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const bib = $(cells[0]).text().trim();
    if (!bib || isNaN(parseInt(bib))) return;
    const name = $(cells[1]).find("span").last().text().trim() || $(cells[1]).text().trim();
    const country = $(cells[3])?.find("img").attr("title") || undefined;
    if (name) entries.push({ bib, name, country });
  });
  return entries;
}

async function processSportstiming(event: typeof schema.raceEvents.$inferSelect) {
  const stId = event.timingEventId!;
  const resultsBase = `https://www.sportstiming.dk/event/${stId}/results`;
  console.log(`  → Sportstiming event ${stId}`);

  const html = await fetchHTML(resultsBase);
  const cats = parseSportstimingCategories(html).filter(c => c.match !== null);
  console.log(`  Found ${cats.length} relevant categories`);

  for (const cat of cats) {
    const { ageCategory, gender } = cat.match!;
    const race = await findRace(event.id, ageCategory, gender);
    if (!race) { console.log(`    ⚠️  No race for ${ageCategory} ${gender}`); continue; }

    await sleep(800);

    // Startlist
    if (!resultsOnly) {
      try {
        const participants = await fetchSportstimingParticipants(stId, cat.id);
        console.log(`    📋 ${cat.name}: ${participants.length} participants`);
        if (!dryRun) {
          for (const p of participants) {
            const riderId = await upsertRider(p.name, p.country);
            if (riderId) await db.insert(schema.raceStartlist).values({ raceId: race.id, riderId, bibNumber: parseInt(p.bib) || null }).onConflictDoNothing();
          }
        }
      } catch (e: any) { console.log(`    ❌ Startlist error: ${e.message}`); }
      await sleep(800);
    }

    // Results
    if (!startlistOnly && new Date(event.date) <= new Date()) {
      try {
        const url1 = `${resultsBase}?distance=${cat.id}&gender=A&page=1`;
        const html1 = await fetchHTML(url1);
        const totalPages = parseTotalPages(html1);
        let all = parseSportstimingResults(html1);
        for (let p = 2; p <= Math.min(totalPages, 20); p++) {
          await sleep(700);
          all = all.concat(parseSportstimingResults(await fetchHTML(`${resultsBase}?distance=${cat.id}&gender=A&page=${p}`)));
        }
        console.log(`    🏁 ${cat.name}: ${all.length} results`);
        if (!dryRun && all.length > 0) {
          for (const r of all) {
            const riderId = await upsertRider(r.name, r.country);
            if (riderId) await db.insert(schema.raceStartlist).values({ raceId: race.id, riderId, bibNumber: parseInt(r.bib) || null }).onConflictDoNothing();
          }
          await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, race.id));
          console.log(`       ✅ Stored, race marked completed`);
        }
      } catch (e: any) { console.log(`    ❌ Results error: ${e.message}`); }
    }

    await sleep(1000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER: RaceResult
// ═══════════════════════════════════════════════════════════════════════════════

interface RaceResultConfig {
  key: string;
  contests: Record<string, string>; // contestId → name
  lists: Array<{ Name: string; Contest: string; ID: string }>;
  server?: string;
}

interface RaceResultData {
  data: Record<string, Array<string[]>>;
  groupFilters?: Array<{ Values: string[] }>;
}

async function fetchRaceResultConfig(eventId: string): Promise<RaceResultConfig> {
  return fetchJSON<RaceResultConfig>(`https://my.raceresult.com/${eventId}/RRPublish/data/config`);
}

async function fetchRaceResultList(eventId: string, key: string, listName: string): Promise<RaceResultData> {
  // IMPORTANT: contest=0 returns ALL contests in one call
  const url = `https://my.raceresult.com/${eventId}/RRPublish/data/list?key=${key}&listname=${encodeURIComponent(listName)}&contest=0`;
  return fetchJSON<RaceResultData>(url);
}

// Parse RaceResult row: [BIB, ID, posDisplay, BIB2, Name, Club, Laps, Time, AvgLap, BestLap, ...]
// Returns null for DNS/DNF/DQ rows
function parseRaceResultRow(row: string[]): { bib: string; name: string; club?: string; position?: number } | null {
  if (row.length < 5) return null;
  const posStr = (row[2] ?? "").toString().trim();
  const name = (row[4] ?? "").toString().trim();
  if (!name) return null;
  const isDNF = /dnf|dns|dq|dsq/i.test(posStr);
  const pos = isDNF ? undefined : parseInt(posStr, 10) || undefined;
  const bib = (row[0] ?? row[3] ?? "").toString().trim();
  const club = (row[5] ?? "").toString().trim() || undefined;
  return { bib, name, club, position: pos };
}

async function processRaceResult(event: typeof schema.raceEvents.$inferSelect) {
  const rrId = event.timingEventId!;
  console.log(`  → RaceResult event ${rrId}`);

  const cfg = await fetchRaceResultConfig(rrId);
  if (!cfg.key) { console.log(`  ❌ No API key in config`); return; }

  // Find the main results list (first list, or one containing "Results")
  const listEntry = cfg.lists.find(l => /result/i.test(l.Name)) ?? cfg.lists[0];
  if (!listEntry) { console.log(`  ❌ No lists in config`); return; }

  console.log(`  Using list: "${listEntry.Name}"`);
  await sleep(500);

  const data = await fetchRaceResultList(rrId, cfg.key, listEntry.Name);
  if (!data?.data) { console.log(`  ❌ Empty data response`); return; }

  // data.data keys are like "#1_UCI C1 XCO Men Elite", "#2_UCI C1 XCO Women Elite", etc.
  for (const [key, rows] of Object.entries(data.data)) {
    // Strip the "#N_" prefix
    const catName = key.replace(/^#\d+_/, "");
    const match = classifyCategory(catName);
    if (!match) { console.log(`    ⏭  Skipping category: ${catName}`); continue; }

    const { ageCategory, gender } = match;
    const race = await findRace(event.id, ageCategory, gender);
    if (!race) { console.log(`    ⚠️  No race for ${ageCategory} ${gender} (${catName})`); continue; }

    console.log(`    📊 ${catName}: ${rows.length} rows`);
    if (dryRun) continue;

    let stored = 0;
    for (const row of rows) {
      const parsed = parseRaceResultRow(row);
      if (!parsed) continue;
      const riderId = await upsertRider(parsed.name);
      if (riderId) {
        await db.insert(schema.raceStartlist).values({
          raceId: race.id,
          riderId,
          bibNumber: parseInt(parsed.bib) || null,
        }).onConflictDoNothing();
        stored++;
      }
    }

    // Mark completed if we have actual results (not just startlist)
    const hasResults = rows.some(r => parseRaceResultRow(r)?.position !== undefined);
    if (hasResults) {
      await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, race.id));
      console.log(`       ✅ ${stored} riders stored, race marked completed`);
    } else {
      console.log(`       📋 ${stored} startlist entries stored`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const today = new Date().toISOString().substring(0, 10);
  const pastDate = new Date(Date.now() - daysBack * 86400000).toISOString().substring(0, 10);
  const futureDate = new Date(Date.now() + daysAhead * 86400000).toISOString().substring(0, 10);

  let events;
  if (eventIdArg) {
    const e = await db.query.raceEvents.findFirst({ where: eq(schema.raceEvents.id, eventIdArg) });
    events = e ? [e] : [];
  } else {
    events = await db.query.raceEvents.findMany({
      where: and(
        eq(schema.raceEvents.discipline, "mtb"),
        gte(schema.raceEvents.date, pastDate),
        lte(schema.raceEvents.date, futureDate),
      ),
      orderBy: [schema.raceEvents.date],
    });
    // Only events with a known timing system (skip xcodata — handled by scrape-mtb-results.ts)
    events = events.filter(e => e.timingSystem && e.timingSystem !== "xcodata" && e.timingEventId);
  }

  if (events.length === 0) { console.log("No events with timing links found."); return; }
  console.log(`Processing ${events.length} event(s)...\n`);

  for (const event of events) {
    console.log(`\n📍 ${event.name} [${event.date}] — ${event.timingSystem}`);
    try {
      if (event.timingSystem === "sportstiming") {
        await processSportstiming(event);
      } else if (event.timingSystem === "raceresult") {
        await processRaceResult(event);
      } else {
        console.log(`  ⏭  Adapter not yet implemented for: ${event.timingSystem}`);
      }
    } catch (e: any) {
      console.log(`  💥 Error: ${e.message}`);
    }
    await sleep(1500);
  }

  console.log("\n✅ Done.");
}

main().catch(console.error);
