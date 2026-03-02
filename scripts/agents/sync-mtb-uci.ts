/**
 * Sync MTB XCO UCI Rankings from XCOdata.com
 *
 * Uses plain fetch (no Playwright, no scrape.do credits) to scrape XCOdata rankings.
 * XCOdata publishes live UCI XCO rankings for all categories.
 *
 * Usage: node_modules/.bin/tsx scripts/agents/sync-mtb-uci.ts [--limit 500]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 500 : 500;

// XCOdata.com ranking URLs — plain fetch works, no JS rendering needed
const CATEGORIES = [
  { label: "Elite Men",     url: "https://www.xcodata.com/rankings/ME/", ageCategory: "elite",  gender: "men"   },
  { label: "Elite Women",   url: "https://www.xcodata.com/rankings/WE/", ageCategory: "elite",  gender: "women" },
  { label: "Junior Men",    url: "https://www.xcodata.com/rankings/MJ/", ageCategory: "junior", gender: "men"   },
  { label: "Junior Women",  url: "https://www.xcodata.com/rankings/WJ/", ageCategory: "junior", gender: "women" },
  { label: "U23 Men",       url: "https://www.xcodata.com/rankings/MU/", ageCategory: "u23",    gender: "men"   },
  { label: "U23 Women",     url: "https://www.xcodata.com/rankings/WU/", ageCategory: "u23",    gender: "women" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function fetchXCO(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
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

interface RankingEntry {
  rank: number;
  riderName: string;
  team: string;
  uciPoints: number;
}

function parseRankingPage(html: string, maxEntries: number): RankingEntry[] {
  const $ = cheerio.load(html);
  const entries: RankingEntry[] = [];

  $("table tbody tr").each((_, row) => {
    if (entries.length >= maxEntries) return false;
    const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
    if (cells.length < 3) return;

    // XCOdata format: [rank, name+team (combined cell), team, points]
    // Rank may have change indicator: "4                 1" → take first number
    const rankRaw = cells[0].replace(/\s+\d+$/, "").trim();
    const rank = parseInt(rankRaw);
    if (!rank || isNaN(rank)) return;

    // Name cell contains "Firstname LASTNAME\n                 TEAM NAME"
    // Split on multiple whitespace/newlines
    const nameCell = cells[1];
    const nameParts = nameCell.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (nameParts.length === 0) return;

    // First line is rider name — XCOdata format: "Firstname LASTNAME"
    const rawName = nameParts[0].trim();
    // Strip any team suffix that leaked in (team names are ALL CAPS in XCOdata)
    // XCOdata name format is "Firstname LASTNAME" (Title case first, ALL CAPS last)
    // But some entries are "LASTNAME Firstname" — detect by ALL CAPS first token
    const riderName = normalizeXCOName(rawName);
    if (!riderName || riderName.length < 3) return;

    const team = nameParts[1] ?? cells[2] ?? "";

    // Points column — last non-empty column, may have change marker "+ 90" or "- 7"
    const pointsRaw = cells[cells.length - 1].replace(/[^0-9]/g, "");
    const uciPoints = parseInt(pointsRaw) || 0;
    if (uciPoints === 0) return;

    entries.push({ rank, riderName, team, uciPoints });
  });

  return entries;
}

// XCOdata uses "Firstname LASTNAME" — convert to consistent "Firstname Lastname"
function normalizeXCOName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return raw.trim();

  // Detect ALL_CAPS tokens (surname in XCOdata style)
  const isAllCaps = (s: string) => /^[A-Z\u00C0-\u00DC\-']+$/.test(s) && s.length > 1;

  const upper: string[] = [];
  const first: string[] = [];
  for (const p of parts) {
    if (isAllCaps(p)) upper.push(p);
    else first.push(p);
  }

  if (upper.length === 0) return raw.trim(); // already normal casing

  // Title-case the surname
  const surname = upper.map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

  // XCOdata is "Firstname LASTNAME" so first names come first
  return first.length > 0
    ? `${first.join(" ")} ${surname}`
    : surname;
}

// ── Name matching ─────────────────────────────────────────────────────────────

function findRider(
  name: string,
  allRiders: { id: string; name: string }[]
): { id: string; name: string } | undefined {
  const norm = stripAccents(name.trim());
  const parts = norm.split(/\s+/);
  const lastName = parts[parts.length - 1];
  const firstName = parts[0];

  // 1. Exact
  let match = allRiders.find(r => stripAccents(r.name) === norm);
  if (match) return match;

  // 2. Last-name only (unique)
  const byLast = allRiders.filter(r => {
    const n = stripAccents(r.name);
    return n === lastName || n.endsWith(" " + lastName);
  });
  if (byLast.length === 1) return byLast[0];

  // 3. First + last
  const byBoth = allRiders.filter(r => {
    const n = stripAccents(r.name);
    return n.startsWith(firstName) && n.endsWith(lastName);
  });
  if (byBoth.length === 1) return byBoth[0];

  return undefined;
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertPoints(
  riderId: string,
  ageCategory: string,
  gender: string,
  rank: number,
  points: number
) {
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(schema.riderDisciplineStats.riderId, riderId),
      eq(schema.riderDisciplineStats.discipline, "mtb"),
      eq(schema.riderDisciplineStats.ageCategory, ageCategory),
      eq(schema.riderDisciplineStats.gender, gender)
    ),
  });

  if (existing) {
    await db
      .update(schema.riderDisciplineStats)
      .set({ uciPoints: points, uciRank: rank, updatedAt: new Date() })
      .where(eq(schema.riderDisciplineStats.id, existing.id));
  } else {
    await db
      .insert(schema.riderDisciplineStats)
      .values({
        riderId, discipline: "mtb", ageCategory, gender,
        uciPoints: points, uciRank: rank,
        currentElo: "1500", eloMean: "1500", eloVariance: "350",
      })
      .onConflictDoNothing();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏔️  MTB UCI XCO Rankings Sync — XCOdata.com\n");
  console.log(`Limit: ${LIMIT} riders per category\n`);

  const allRiders = await db.query.riders.findMany({ columns: { id: true, name: true } });
  console.log(`Loaded ${allRiders.length} riders from DB\n`);

  let totalUpdated = 0, totalCreated = 0, totalNotFound = 0;

  for (const cat of CATEGORIES) {
    console.log(`── ${cat.label} ──`);

    let html: string;
    try {
      html = await fetchXCO(cat.url);
    } catch (e: any) {
      console.warn(`  ❌ Fetch failed: ${e.message}`);
      continue;
    }

    const entries = parseRankingPage(html, LIMIT);
    console.log(`  Parsed ${entries.length} riders`);

    let updated = 0, created = 0, notFound = 0;

    for (const entry of entries) {
      const match = findRider(entry.riderName, allRiders);

      if (!match) {
        const [newRider] = await db
          .insert(schema.riders)
          .values({ name: entry.riderName })
          .onConflictDoNothing()
          .returning({ id: schema.riders.id });

        if (newRider) {
          allRiders.push({ id: newRider.id, name: entry.riderName });
          await upsertPoints(newRider.id, cat.ageCategory, cat.gender, entry.rank, entry.uciPoints);
          created++;
        } else {
          notFound++;
        }
        continue;
      }

      await upsertPoints(match.id, cat.ageCategory, cat.gender, entry.rank, entry.uciPoints);
      updated++;
    }

    console.log(`  ✅ ${updated} updated, ${created} new, ${notFound} unmatched`);
    totalUpdated += updated;
    totalCreated += created;
    totalNotFound += notFound;

    await new Promise(r => setTimeout(r, 1000)); // polite delay
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Done — ${totalUpdated} updated, ${totalCreated} new, ${totalNotFound} unmatched`);
}

main().catch(console.error);
