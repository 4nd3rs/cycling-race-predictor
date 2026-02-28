/**
 * Sync MTB UCI XCO Rankings from dataride.uci.ch (official UCI source)
 *
 * Navigates the UCI dataride rankings page, discovers ranking URLs for each
 * category by interacting with the Kendo UI dropdowns, then scrapes the full
 * paginated ranking tables.
 *
 * Usage: node_modules/.bin/tsx scripts/agents/sync-mtb-uci.ts [--limit 500]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium, type Page } from "playwright";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 500 : 500;

const CATEGORIES = [
  { dropdownName: "Men Elite",    ageCategory: "elite",  gender: "men"   },
  { dropdownName: "Women Elite",  ageCategory: "elite",  gender: "women" },
  { dropdownName: "Men Junior",   ageCategory: "junior", gender: "men"   },
  { dropdownName: "Women Junior", ageCategory: "junior", gender: "women" },
];

// ── UCI page interaction ─────────────────────────────────────────────────────

async function selectCategoryAndGetUrl(page: Page, categoryName: string): Promise<string | null> {
  // Category dropdown is the 2nd Kendo dropdown on the page
  const dropdowns = await page.$$(".k-widget.k-dropdown");
  if (dropdowns.length < 2) return null;

  await dropdowns[1].click();
  await page.waitForTimeout(500);

  const option = page.locator(`.k-animation-container li.k-item:has-text("${categoryName}")`).first();
  if (!await option.isVisible({ timeout: 3000 }).catch(() => false)) return null;
  await option.click();
  await page.waitForTimeout(2000);

  const links: string[] = await page.$$eval(
    "a[href*='RankingDetails'][href*='raceTypeId=92']",
    (as) => (as as HTMLAnchorElement[])
      .filter(a => new URL(a.href).searchParams.get("rankingTypeId") === "1")
      .map(a => a.href)
  );
  return links[0] ?? null;
}

// ── Table parsing ─────────────────────────────────────────────────────────────

interface RankEntry {
  rank: number;
  name: string;
  nation: string;
  points: number;
}

function parseRows(rows: string[][]): RankEntry[] {
  const entries: RankEntry[] = [];
  for (const row of rows) {
    if (row.length < 9) continue;
    const rank = parseInt(row[0]);
    if (isNaN(rank) || rank === 0) continue;
    const name   = row[5]?.trim() ?? "";
    const nation = row[6]?.trim() ?? "";
    const points = parseFloat(row[9]) || 0;
    if (!name || points === 0) continue;
    entries.push({ rank, name, nation, points });
  }
  return entries;
}

async function scrapeFullRanking(page: Page, rankingUrl: string): Promise<RankEntry[]> {
  await page.goto(rankingUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const all: RankEntry[] = [];

  while (all.length < LIMIT) {
    const rows = await page.$$eval("table tbody tr", rows =>
      rows.map(row =>
        Array.from(row.querySelectorAll("td")).map(td => td.innerText.trim())
      )
    );
    const entries = parseRows(rows);
    all.push(...entries);

    // Next page
    const nextBtn = await page.$("a.k-link[title='Go to the next page']:not(.k-state-disabled)");
    if (!nextBtn) break;
    await nextBtn.click();
    await page.waitForTimeout(1500);
  }

  return all.slice(0, LIMIT);
}

// ── Name matching ─────────────────────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// UCI format: "LASTNAME Firstname" (all-caps = surname)
function normaliseUciName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return stripAccents(raw);
  const upper: string[] = [], first: string[] = [];
  for (const p of parts) {
    if (/^[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇÆŒÑ\-']+$/.test(p)) upper.push(p);
    else first.push(p);
  }
  if (!first.length) first.push(upper.pop()!);
  return stripAccents([...first, ...upper].join(" "));
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertPoints(riderId: string, ageCategory: string, gender: string, rank: number, points: number) {
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(schema.riderDisciplineStats.riderId, riderId),
      eq(schema.riderDisciplineStats.discipline, "mtb"),
      eq(schema.riderDisciplineStats.ageCategory, ageCategory),
      eq(schema.riderDisciplineStats.gender, gender),
    ),
  });

  if (existing) {
    await db.update(schema.riderDisciplineStats)
      .set({ uciPoints: points, uciRank: rank, updatedAt: new Date() })
      .where(eq(schema.riderDisciplineStats.id, existing.id));
  } else {
    await db.insert(schema.riderDisciplineStats).values({
      riderId, discipline: "mtb", ageCategory, gender,
      uciPoints: points, uciRank: rank,
      currentElo: "1500", eloMean: "1500", eloVariance: "350",
    }).onConflictDoNothing();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏔️  MTB UCI XCO Rankings Sync — dataride.uci.ch\n");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Load overview page once
  await page.goto("https://dataride.uci.ch/iframe/rankings/7", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Pre-load all DB riders for name matching
  const allRiders = await db.query.riders.findMany({ columns: { id: true, name: true } });
  console.log(`Loaded ${allRiders.length} riders from DB\n`);

  let totalUpdated = 0, totalNotFound = 0;

  for (const cat of CATEGORIES) {
    console.log(`Scraping ${cat.dropdownName}...`);

    const rankingUrl = await selectCategoryAndGetUrl(page, cat.dropdownName);
    if (!rankingUrl) {
      console.log(`  ⚠️  Could not find ranking URL`);
      continue;
    }

    const entries = await scrapeFullRanking(page, rankingUrl);
    console.log(`  Fetched ${entries.length} riders from UCI`);

    let updated = 0, notFound = 0;

    for (const entry of entries) {
      const normName = normaliseUciName(entry.name);

      // Exact match
      let match = allRiders.find(r => stripAccents(r.name) === normName);

      // Last-name fallback
      if (!match) {
        const parts = normName.split(" ");
        const lastName = parts[parts.length - 1];
        const candidates = allRiders.filter(r => {
          const n = stripAccents(r.name);
          return n.endsWith(" " + lastName) || n === lastName;
        });
        if (candidates.length === 1) match = candidates[0];
      }

      if (!match) { notFound++; continue; }

      await upsertPoints(match.id, cat.ageCategory, cat.gender, entry.rank, entry.points);
      updated++;
    }

    console.log(`  ✅ ${updated} updated, ${notFound} not matched in DB`);
    totalUpdated += updated;
    totalNotFound += notFound;

    // Go back to overview for next category
    await page.goto("https://dataride.uci.ch/iframe/rankings/7", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  await browser.close();
  console.log(`\nDone — ${totalUpdated} updated, ${totalNotFound} not in DB`);
}

main().catch(console.error);
