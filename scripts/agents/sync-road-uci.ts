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
import * as cheerio from "cheerio";
import { scrapeDo } from "../../src/lib/scraper/scrape-do";

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
  baseUrl: string,
  maxEntries: number
): Promise<RankingEntry[]> {
  const entries: RankingEntry[] = [];
  let page = 1;

  while (entries.length < maxEntries) {
    const url = page === 1 ? baseUrl : `${baseUrl}/p/${page}`;
    try {
      console.log(`  Loading: ${url}`);
      const html = await scrapeDo(url, { timeout: 60000 });
      const $ = cheerio.load(html);

      let rowsOnPage = 0;
      // PCS table: [rank, prev, diff, "LASTNAME Firstname", team, points]
      $("table tbody tr").each((_, row) => {
        const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
        if (cells.length < 4) return;

        const rank = parseInt(cells[0]);
        if (!rank || rank === 0) return;

        // cells[3] = "VAN DER POEL Mathieu" — PCS ALL CAPS SURNAME + First name
        // Convert to "Mathieu van der Poel" format
        const rawName = cells[3];
        if (!rawName || rawName.length < 3) return;

        const parts = rawName.split(" ");
        const firstName = parts[parts.length - 1]; // Last token = first name
        const lastName = parts.slice(0, -1).join(" "); // Rest = surname
        // PCS surname is ALL CAPS — convert to Title Case
        const lastNameTitle = lastName.split(" ").map(w =>
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        ).join(" ");
        const riderName = `${firstName} ${lastNameTitle}`.trim();

        // points = last column
        // Take only the first number (avoids "2,633\n100" → "2633100" concat bug)
        const uciPoints = parseInt((cells[cells.length - 1].match(/[\d,]+/) || ["0"])[0].replace(/,/g, "")) || 0;
        const team = cells[4] || "";

        entries.push({ rank, riderName, team, uciPoints, nationality: "" });
        rowsOnPage++;
      });

      if (rowsOnPage < 10) break; // last page or empty
      page++;
      await new Promise(r => setTimeout(r, 600)); // polite delay between pages
    } catch (err: any) {
      console.error(`  Error scraping ${url}: ${err.message}`);
      break;
    }
  }

  return entries.slice(0, maxEntries);
}

async function syncRankings(
  entries: RankingEntry[],
  gender: string
): Promise<{ updated: number; notFound: number }> {
  // Load all riders from DB for matching (no limit — DB has 17k+ riders)
  const allRiders = await db
    .select({ id: schema.riders.id, name: schema.riders.name })
    .from(schema.riders)
    .limit(30000);

  // Build a lookup map by stripped name — support both "First Last" and "Last First" formats
  const ridersByStrippedName = new Map<string, { id: string; name: string }>();
  for (const rider of allRiders) {
    const stripped = stripAccents(rider.name);
    ridersByStrippedName.set(stripped, rider);

    // Also index the reversed form (DB uses "Last First"; PCS gives "First Last")
    // "Van Der Poel Mathieu" → also index as "Mathieu Van Der Poel"
    const parts = stripped.split(" ");
    if (parts.length >= 2) {
      const reversed = parts[parts.length - 1] + " " + parts.slice(0, -1).join(" ");
      if (!ridersByStrippedName.has(reversed)) {
        ridersByStrippedName.set(reversed, rider);
      }
    }
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
        // Spread ELO across full UCI range: #1 (≈4000 pts) → ~1800, avg → ~1600
        const eloBoost = Math.round((entry.uciPoints / 4000) * 350);
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
      const eloBoost = Math.round((entry.uciPoints / 4000) * 350);
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

  // Women's rankings — wait a moment to avoid scrape.do rate limits after men's pages
  await new Promise(r => setTimeout(r, 3000));
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
