/**
 * Sync Road UCI Rankings from ProCyclingStats
 *
 * Scrapes PCS road rankings using Playwright and updates riderDisciplineStats
 * for existing riders in the database.
 *
 * Usage: node_modules/.bin/tsx scripts/agents/sync-road-uci.ts [--limit 500]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium } from "playwright";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 300 : 300;

function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

interface RankingEntry {
  rank: number;
  riderName: string;
  team: string;
  uciPoints: number;
  nationality: string;
}

async function scrapeRankingsPage(
  url: string,
  maxEntries: number
): Promise<RankingEntry[]> {
  const entries: RankingEntry[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    console.log(`  Loading: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector("table", { timeout: 10000 }).catch(() => {});

    // PCS table: [rank, prev, diff, "LASTNAME Firstname", team, points]
    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map(td => td.textContent?.trim() ?? "");
        return cells;
      })
    );

    for (const cells of rows) {
      if (entries.length >= maxEntries) break;
      if (cells.length < 4) continue;

      const rank = parseInt(cells[0]);
      if (!rank || rank === 0) continue;

      // cells[3] = "VAN DER POEL Mathieu" — PCS ALL CAPS SURNAME + First name
      // Convert to "Mathieu van der Poel" format
      const rawName = cells[3];
      if (!rawName || rawName.length < 3) continue;

      const parts = rawName.split(" ");
      const firstName = parts[parts.length - 1]; // Last token = first name
      const lastName = parts.slice(0, -1).join(" "); // Rest = surname
      // PCS surname is ALL CAPS — convert to Title Case
      const lastNameTitle = lastName.split(" ").map(w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(" ");
      const riderName = `${firstName} ${lastNameTitle}`.trim();

      // points = last column
      const uciPoints = parseInt(cells[cells.length - 1]) || 0;
      const team = cells[4] || "";

      entries.push({ rank, riderName, team, uciPoints, nationality: "" });
    }
  } catch (err: any) {
    console.error(`  Error scraping ${url}: ${err.message}`);
  } finally {
    await browser.close();
  }

  return entries;
}

async function syncRankings(
  entries: RankingEntry[],
  gender: string
): Promise<{ updated: number; notFound: number }> {
  // Load all riders from DB for matching
  const allRiders = await db
    .select({ id: schema.riders.id, name: schema.riders.name })
    .from(schema.riders)
    .limit(10000);

  // Build a lookup map by stripped name
  const ridersByStrippedName = new Map<string, { id: string; name: string }>();
  for (const rider of allRiders) {
    ridersByStrippedName.set(stripAccents(rider.name), rider);
  }

  let updated = 0;
  let notFound = 0;

  for (const entry of entries) {
    // Try to find rider in DB
    const strippedName = stripAccents(entry.riderName);
    const rider = ridersByStrippedName.get(strippedName);

    if (!rider) {
      notFound++;
      continue;
    }

    const discipline = "road";
    const ageCategory = "elite";

    // Find existing discipline stats
    const existingStats = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(schema.riderDisciplineStats.riderId, rider.id),
        eq(schema.riderDisciplineStats.discipline, discipline),
        eq(schema.riderDisciplineStats.ageCategory, ageCategory)
      ),
    });

    if (existingStats) {
      // Update UCI points and rank
      const updates: Record<string, unknown> = {
        uciPoints: entry.uciPoints,
        uciRank: entry.rank,
        gender,
        updatedAt: new Date(),
      };

      // If no existing ELO (still at default 1500 with no races), boost based on UCI points
      if ((existingStats.racesTotal ?? 0) === 0) {
        const eloBoost = Math.min((entry.uciPoints / 2000) * 200, 200);
        const newElo = 1500 + eloBoost;
        updates.eloMean = String(newElo.toFixed(4));
        updates.currentElo = String(newElo.toFixed(2));
      }

      await db
        .update(schema.riderDisciplineStats)
        .set(updates)
        .where(eq(schema.riderDisciplineStats.id, existingStats.id));
    } else {
      // Create new discipline stats with UCI-boosted ELO
      const eloBoost = Math.min((entry.uciPoints / 2000) * 200, 200);
      const newElo = 1500 + eloBoost;

      await db
        .insert(schema.riderDisciplineStats)
        .values({
          riderId: rider.id,
          discipline,
          ageCategory,
          gender,
          uciPoints: entry.uciPoints,
          uciRank: entry.rank,
          currentElo: String(newElo.toFixed(2)),
          eloMean: String(newElo.toFixed(4)),
          eloVariance: "350",
        })
        .onConflictDoNothing();
    }

    updated++;
    if (updated % 50 === 0) {
      console.log(`  ... ${updated} riders updated`);
    }
  }

  return { updated, notFound };
}

async function main() {
  console.log(`\nRoad UCI Rankings Sync (limit: ${limit})\n`);

  let totalUpdated = 0;
  let totalNotFound = 0;

  // Men's rankings
  console.log("Men Elite Rankings:");
  const menEntries = await scrapeRankingsPage(
    "https://www.procyclingstats.com/rankings/me/uci-individual",
    limit
  );
  console.log(`  Scraped ${menEntries.length} entries from PCS`);

  if (menEntries.length > 0) {
    const menResult = await syncRankings(menEntries, "men");
    console.log(
      `  Result: ${menResult.updated} updated, ${menResult.notFound} not found in DB`
    );
    totalUpdated += menResult.updated;
    totalNotFound += menResult.notFound;
  }

  // Women's rankings
  console.log("\nWomen Elite Rankings:");
  const womenEntries = await scrapeRankingsPage(
    "https://www.procyclingstats.com/rankings/we/world-ranking",
    limit
  );
  console.log(`  Scraped ${womenEntries.length} entries from PCS`);

  if (womenEntries.length > 0) {
    const womenResult = await syncRankings(womenEntries, "women");
    console.log(
      `  Result: ${womenResult.updated} updated, ${womenResult.notFound} not found in DB`
    );
    totalUpdated += womenResult.updated;
    totalNotFound += womenResult.notFound;
  }

  console.log(
    `\nSync complete: ${totalUpdated} riders updated, ${totalNotFound} not found in DB`
  );
  console.log(
    `openclaw system event --text "Road UCI sync complete: ${totalUpdated} riders updated" --mode now`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
