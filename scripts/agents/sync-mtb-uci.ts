/**
 * Sync MTB XCO UCI Rankings from ProCyclingStats
 *
 * Uses plain scrape.do (no render, no Playwright) to fetch PCS rankings tables.
 * Updates riderDisciplineStats for all MTB categories: Elite Men/Women + Junior Men/Women.
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
import { scrapeDo } from "../../src/lib/scraper/scrape-do";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 500 : 500;

// PCS MTB XCO ranking URLs — all work with plain scrape.do (no JS render needed)
const CATEGORIES = [
  {
    label: "Elite Men",
    url: "https://www.procyclingstats.com/rankings/xco/individual",
    ageCategory: "elite",
    gender: "men",
  },
  {
    label: "Elite Women",
    url: "https://www.procyclingstats.com/rankings/xco-women/individual",
    ageCategory: "elite",
    gender: "women",
  },
  {
    label: "Junior Men",
    url: "https://www.procyclingstats.com/rankings/xco-junior/individual",
    ageCategory: "junior",
    gender: "men",
  },
  {
    label: "Junior Women",
    url: "https://www.procyclingstats.com/rankings/xco-junior-women/individual",
    ageCategory: "junior",
    gender: "women",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

interface RankingEntry {
  rank: number;
  riderName: string;
  nationality: string;
  team: string;
  uciPoints: number;
}

// ── PCS page scraper ──────────────────────────────────────────────────────────

async function scrapeCategory(url: string, maxEntries: number): Promise<RankingEntry[]> {
  const entries: RankingEntry[] = [];
  let page = 0;

  while (entries.length < maxEntries) {
    const pageUrl = page === 0 ? url : `${url}?nation=&age=&page=${page}&offset=${page * 100}&filter=Filter&p=you&s=ucipts`;
    console.log(`    Fetching page ${page + 1}: ${pageUrl}`);

    let html: string;
    try {
      html = await scrapeDo(pageUrl);
    } catch (e: any) {
      console.warn(`    ⚠️  scrape.do failed: ${e.message?.slice(0, 80)}`);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $("table tbody tr");
    if (rows.length === 0) break;

    let pageCount = 0;
    rows.each((_, row) => {
      if (entries.length >= maxEntries) return false;
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      if (cells.length < 4) return;

      const rank = parseInt(cells[0]);
      if (!rank || isNaN(rank)) return;

      // PCS format: "VAN DER POEL Mathieu" — ALL CAPS surname + First name (last token)
      const rawName = cells[3];
      if (!rawName || rawName.length < 3) return;
      const parts = rawName.trim().split(/\s+/);
      const firstName = parts[parts.length - 1];
      const lastNameTitle = parts.slice(0, -1).map(w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(" ");
      const riderName = `${firstName} ${lastNameTitle}`.trim();

      const uciPoints = parseInt(cells[cells.length - 1].replace(/[^0-9]/g, "")) || 0;
      const nationality = $(row).find("span.flag").attr("class")?.match(/flag-([a-z]{2})/i)?.[1]?.toUpperCase() ?? "";
      const team = cells[4] ?? "";

      entries.push({ rank, riderName, nationality, team, uciPoints });
      pageCount++;
    });

    if (pageCount < 50) break; // Last page (PCS shows 100 per page typically)
    page++;
    await new Promise(r => setTimeout(r, 1500)); // polite delay
  }

  return entries;
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
        riderId,
        discipline: "mtb",
        ageCategory,
        gender,
        uciPoints: points,
        uciRank: rank,
        currentElo: "1500",
        eloMean: "1500",
        eloVariance: "350",
      })
      .onConflictDoNothing();
  }
}

// ── Name matching ─────────────────────────────────────────────────────────────

function normaliseName(raw: string): string {
  return stripAccents(raw.trim());
}

function findRider(
  name: string,
  allRiders: { id: string; name: string }[]
): { id: string; name: string } | undefined {
  const norm = normaliseName(name);

  // 1. Exact match
  let match = allRiders.find(r => normaliseName(r.name) === norm);
  if (match) return match;

  // 2. Last-name fallback
  const parts = norm.split(" ");
  const lastName = parts[parts.length - 1];
  const candidates = allRiders.filter(r => {
    const n = normaliseName(r.name);
    return n === lastName || n.endsWith(" " + lastName);
  });
  if (candidates.length === 1) return candidates[0];

  // 3. First + last token match
  const firstName = parts[0];
  const both = allRiders.filter(r => {
    const n = normaliseName(r.name);
    return n.startsWith(firstName + " ") && n.endsWith(" " + lastName);
  });
  if (both.length === 1) return both[0];

  return undefined;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏔️  MTB UCI XCO Rankings Sync — ProCyclingStats\n");
  console.log(`Limit: ${LIMIT} riders per category\n`);

  // Pre-load all riders for name matching
  const allRiders = await db.query.riders.findMany({
    columns: { id: true, name: true },
  });
  console.log(`Loaded ${allRiders.length} riders from DB\n`);

  let totalUpdated = 0, totalCreated = 0, totalNotFound = 0;

  for (const cat of CATEGORIES) {
    console.log(`\n── ${cat.label} ──`);

    let entries: RankingEntry[];
    try {
      entries = await scrapeCategory(cat.url, LIMIT);
    } catch (e: any) {
      console.error(`  ❌ Failed: ${e.message}`);
      continue;
    }
    console.log(`  Fetched ${entries.length} riders from PCS`);

    let updated = 0, created = 0, notFound = 0;

    for (const entry of entries) {
      const match = findRider(entry.riderName, allRiders);

      if (!match) {
        // Create rider so future startlist scrapes can match
        const [newRider] = await db
          .insert(schema.riders)
          .values({ name: entry.riderName, nationality: entry.nationality })
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

    console.log(`  ✅ ${updated} updated, ${created} new riders created, ${notFound} unmatched`);
    totalUpdated += updated;
    totalCreated += created;
    totalNotFound += notFound;
  }

  console.log(`\n──────────────────────────────`);
  console.log(`Done — ${totalUpdated} updated, ${totalCreated} new, ${totalNotFound} unmatched`);
}

main().catch(console.error);
