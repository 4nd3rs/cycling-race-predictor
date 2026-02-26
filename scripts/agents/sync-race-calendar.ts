/**
 * Sync Race Calendar Agent
 *
 * Scrapes upcoming UCI road + MTB races from multiple sources and upserts
 * them into the database. Sources (priority order):
 *   1. ProCyclingStats race calendar  (road — Playwright)
 *   2. XCOdata race list              (MTB — existing scraper)
 *   3. UCI official calendar           (fallback — Playwright, optional)
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/agents/sync-race-calendar.ts [--discipline road|mtb|all] [--months 3]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq, gte, lte, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "../../src/lib/url-utils";
import { scrapeXCOdataRacesList } from "../../src/lib/scraper/xcodata-races";
import { chromium, type Browser } from "playwright";
import * as cheerio from "cheerio";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const discipline = getArg("discipline", "all") as "road" | "mtb" | "all";
const months = parseInt(getArg("months", "3"), 10);

// ─── Constants ────────────────────────────────────────────────────────────────

const today = new Date();
const todayStr = today.toISOString().split("T")[0];
const cutoff = new Date(today);
cutoff.setDate(cutoff.getDate() + months * 30);
const cutoffStr = cutoff.toISOString().split("T")[0];

const UCI_ROAD_CATS: Record<string, string> = {
  worldtour: "WorldTour",
  "2.pro": "2.Pro",
  "1.pro": "1.Pro",
  "2.hc": "2.HC",
  "1.hc": "1.HC",
  "2.1": "2.1",
  "1.1": "1.1",
  "2.2": "2.2",
  "1.2": "1.2",
  nc: "NC",
};

/** Minimum categories to import (skip 2.1, 2.2, etc. by default) */
const MIN_ROAD_CATS = new Set([
  "WorldTour",
  "2.Pro",
  "1.Pro",
  "2.HC",
  "1.HC",
  "1.1",
]);

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ScrapedRace {
  name: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  country?: string;
  uciCategory?: string;
  pcsUrl?: string;
  sourceUrl?: string;
  discipline: "road" | "mtb";
  subDiscipline?: string;
  series?: string;
}

interface SyncStats {
  found: number;
  inserted: number;
  existed: number;
  errors: number;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parsePcsDate(raw: string): string | null {
  // PCS dates: "01.03", "01.03 - 07.03", "2026.03.01", etc.
  const cleaned = raw.trim().split("-")[0].trim().split("»")[0].trim();

  // Format: DD.MM or DD/MM
  const shortMatch = cleaned.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (shortMatch) {
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    const year = today.getFullYear();
    return `${year}-${month}-${day}`;
  }

  // Format: YYYY.MM.DD or YYYY-MM-DD
  const longMatch = cleaned.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})$/);
  if (longMatch) {
    return `${longMatch[1]}-${longMatch[2].padStart(2, "0")}-${longMatch[3].padStart(2, "0")}`;
  }

  // Format: DD Month YYYY (e.g., "01 March 2026")
  const monthNames: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const textMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (textMatch) {
    const month = monthNames[textMatch[2].toLowerCase()];
    if (month) {
      return `${textMatch[3]}-${month}-${textMatch[1].padStart(2, "0")}`;
    }
  }

  return null;
}

function isInDateRange(dateStr: string): boolean {
  return dateStr >= todayStr && dateStr <= cutoffStr;
}

// ─── Dedup check ──────────────────────────────────────────────────────────────

async function raceExists(name: string, dateStr: string): Promise<boolean> {
  const dateObj = new Date(dateStr);
  const dayBefore = new Date(dateObj);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(dateObj);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const dayBeforeStr = dayBefore.toISOString().split("T")[0];
  const dayAfterStr = dayAfter.toISOString().split("T")[0];

  // Check race_events table
  const [existingEvent] = await db
    .select({ id: schema.raceEvents.id })
    .from(schema.raceEvents)
    .where(
      and(
        ilike(schema.raceEvents.name, `%${name}%`),
        gte(schema.raceEvents.date, dayBeforeStr),
        lte(schema.raceEvents.date, dayAfterStr)
      )
    )
    .limit(1);

  if (existingEvent) return true;

  // Check races table
  const [existingRace] = await db
    .select({ id: schema.races.id })
    .from(schema.races)
    .where(
      and(
        ilike(schema.races.name, `%${name}%`),
        gte(schema.races.date, dayBeforeStr),
        lte(schema.races.date, dayAfterStr)
      )
    )
    .limit(1);

  return !!existingRace;
}

// ─── Upsert race into DB ─────────────────────────────────────────────────────

async function upsertRace(race: ScrapedRace): Promise<"inserted" | "existed" | "error"> {
  try {
    // Check for existing race/event
    const exists = await raceExists(race.name, race.date);

    if (exists) {
      // Update pcsUrl / sourceUrl on existing events if newly found
      if (race.pcsUrl) {
        const dateObj = new Date(race.date);
        const dayBefore = new Date(dateObj);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const dayAfter = new Date(dateObj);
        dayAfter.setDate(dayAfter.getDate() + 1);

        const dayBeforeStr = dayBefore.toISOString().split("T")[0];
        const dayAfterStr = dayAfter.toISOString().split("T")[0];

        // Update races with pcsUrl if they match and don't have one
        const matchingRaces = await db
          .select({ id: schema.races.id, pcsUrl: schema.races.pcsUrl })
          .from(schema.races)
          .where(
            and(
              ilike(schema.races.name, `%${race.name}%`),
              gte(schema.races.date, dayBeforeStr),
              lte(schema.races.date, dayAfterStr)
            )
          );

        for (const r of matchingRaces) {
          if (!r.pcsUrl && race.pcsUrl) {
            await db
              .update(schema.races)
              .set({ pcsUrl: race.pcsUrl })
              .where(eq(schema.races.id, r.id));
          }
        }
      }
      return "existed";
    }

    // Generate unique event slug
    const baseSlug = generateEventSlug(race.name);
    const existingSlugs = await db
      .select({ slug: schema.raceEvents.slug })
      .from(schema.raceEvents)
      .where(eq(schema.raceEvents.discipline, race.discipline));
    const slugSet = new Set(
      existingSlugs.map((e) => e.slug).filter(Boolean) as string[]
    );
    const eventSlug = makeSlugUnique(baseSlug, slugSet);

    // Insert race_event
    const [newEvent] = await db
      .insert(schema.raceEvents)
      .values({
        name: race.name,
        slug: eventSlug,
        date: race.date,
        endDate: race.endDate || null,
        discipline: race.discipline,
        subDiscipline: race.subDiscipline || null,
        country: race.country || null,
        sourceUrl: race.sourceUrl || race.pcsUrl || null,
        sourceType: race.pcsUrl ? "pcs" : "agent",
        series: race.series || null,
      })
      .onConflictDoNothing()
      .returning();

    if (!newEvent) {
      // Conflict on slug — event already exists
      return "existed";
    }

    // Create men + women elite races
    const genders = ["men", "women"];
    for (const gender of genders) {
      const categorySlug = generateCategorySlug("elite", gender);
      const genderLabel = gender.charAt(0).toUpperCase() + gender.slice(1);
      const raceName = `${race.name} - Elite ${genderLabel}`;

      await db
        .insert(schema.races)
        .values({
          name: raceName,
          categorySlug,
          date: race.date,
          endDate: race.endDate || null,
          discipline: race.discipline,
          raceType: race.subDiscipline || (race.endDate ? "stage_race" : "one_day"),
          ageCategory: "elite",
          gender,
          uciCategory: race.uciCategory || null,
          country: race.country || null,
          raceEventId: newEvent.id,
          pcsUrl: race.pcsUrl || null,
          status: "active",
        })
        .onConflictDoNothing();
    }

    return "inserted";
  } catch (err) {
    console.error(`  Error upserting "${race.name}": ${err}`);
    return "error";
  }
}

// ─── PCS Road Calendar Scraper ────────────────────────────────────────────────

function normalizePcsCategory(raw: string): string | null {
  const lower = raw.toLowerCase().replace(/\s+/g, "").trim();
  // Direct lookup
  if (UCI_ROAD_CATS[lower]) return UCI_ROAD_CATS[lower];
  // Try partial matching
  for (const [key, value] of Object.entries(UCI_ROAD_CATS)) {
    if (lower.includes(key)) return value;
  }
  // WT shorthand
  if (lower.includes("wt") || lower.includes("worldtour")) return "WorldTour";
  return null;
}

async function scrapePcsCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    console.log("  Loading PCS race calendar...");
    await page.goto("https://www.procyclingstats.com/races.php", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for race table to load
    await page
      .waitForSelector("table.tablesorter, table.basic, .racelisttable, table.sortTabl", {
        timeout: 15000,
      })
      .catch(() => {});

    // Try extracting from the table
    const pcsRaces = await page.$$eval(
      "table tbody tr, ul.raceList li",
      (rows) => {
        return rows
          .map((row) => {
            const cells = row.querySelectorAll("td, .race-item");
            const link = row.querySelector('a[href*="/race/"]');
            return {
              name: link?.textContent?.trim() || "",
              url: link?.getAttribute("href") || "",
              date: cells[0]?.textContent?.trim() || "",
              country: cells[1]?.textContent?.trim() || "",
              category: cells[2]?.textContent?.trim() || "",
            };
          })
          .filter((r) => r.name && r.url);
      }
    );

    let rowsToParse = pcsRaces;

    // Fallback: get page HTML and parse with cheerio
    if (rowsToParse.length === 0) {
      console.log("  PCS table empty, trying cheerio fallback...");
      const html = await page.content();
      const $ = cheerio.load(html);
      const cheerioRaces: typeof pcsRaces = [];

      $("table tbody tr").each((_, tr) => {
        const cells = $(tr).find("td");
        const link = $(tr).find('a[href*="/race/"]').first();
        if (link.length) {
          cheerioRaces.push({
            name: link.text().trim(),
            url: link.attr("href") || "",
            date: cells.eq(0).text().trim(),
            country: cells.eq(1).text().trim(),
            category: cells.eq(2).text().trim(),
          });
        }
      });

      rowsToParse = cheerioRaces;
    }

    console.log(`  PCS: ${rowsToParse.length} raw rows parsed`);

    for (const row of rowsToParse) {
      try {
        const dateStr = parsePcsDate(row.date);
        if (!dateStr || !isInDateRange(dateStr)) continue;

        const category = normalizePcsCategory(row.category || "");
        if (!category || !MIN_ROAD_CATS.has(category)) continue;

        // Build PCS URL
        let pcsUrl: string | undefined;
        if (row.url) {
          pcsUrl = row.url.startsWith("http")
            ? row.url
            : `https://www.procyclingstats.com/${row.url.replace(/^\//, "")}`;
        }

        // Extract country code (PCS uses 2-3 letter codes)
        const country = row.country?.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3) || undefined;

        races.push({
          name: row.name,
          date: dateStr,
          country,
          uciCategory: category,
          pcsUrl,
          sourceUrl: pcsUrl,
          discipline: "road",
        });
      } catch {
        // Skip bad rows silently
      }
    }
  } catch (err) {
    console.error(`  PCS scrape error: ${err}`);
  } finally {
    if (browser) await browser.close();
  }

  return races;
}

// ─── MTB XCOdata Scraper ──────────────────────────────────────────────────────

async function scrapeMtbCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];

  try {
    const currentYear = today.getFullYear();
    // Fetch upcoming races (no results required — we want future races)
    const xcoRaces = await scrapeXCOdataRacesList(currentYear, ["WC", "WCH", "C1"], false);

    for (const xco of xcoRaces) {
      if (!isInDateRange(xco.date)) continue;

      // Map XCOdata race class to a series name
      let series: string | undefined;
      const classUpper = xco.raceClass.toUpperCase();
      if (classUpper === "WC") series = "world-cup";
      else if (classUpper === "WCH") series = "world-championships";

      races.push({
        name: xco.name,
        date: xco.date,
        country: xco.country || undefined,
        uciCategory: classUpper === "WC" ? "WC" : classUpper === "WCH" ? "WCH" : "C1",
        sourceUrl: xco.url,
        discipline: "mtb",
        subDiscipline: "xco",
        series,
      });
    }
  } catch (err) {
    console.error(`  XCOdata scrape error: ${err}`);
  }

  return races;
}

// ─── UCI Official Calendar (optional fallback) ────────────────────────────────

async function scrapeUciCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    console.log("  Loading UCI official calendar (optional)...");
    await page.goto("https://www.uci.org/calendar", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // UCI calendar is heavily JS-rendered — wait a bit
    await page.waitForTimeout(5000);

    // Try to extract any visible race entries
    const uciRaces = await page
      .$$eval(".calendar-list-item, .event-row, [class*='event']", (items) => {
        return items
          .map((item) => {
            const name = item.querySelector("h3, .event-name, .title")?.textContent?.trim() || "";
            const date = item.querySelector("time, .date, [class*='date']")?.textContent?.trim() || "";
            const country = item.querySelector(".country, [class*='country']")?.textContent?.trim() || "";
            return { name, date, country };
          })
          .filter((r) => r.name);
      })
      .catch(() => [] as Array<{ name: string; date: string; country: string }>);

    console.log(`  UCI: ${uciRaces.length} entries found`);

    // Parse whatever we get (best effort)
    for (const entry of uciRaces) {
      const dateStr = parsePcsDate(entry.date);
      if (!dateStr || !isInDateRange(dateStr)) continue;

      races.push({
        name: entry.name,
        date: dateStr,
        country: entry.country?.slice(0, 3).toUpperCase() || undefined,
        discipline: "road",
        sourceUrl: "https://www.uci.org/calendar",
      });
    }
  } catch (err) {
    // UCI scraping is optional — skip gracefully
    console.log(`  UCI calendar scrape skipped: ${err instanceof Error ? err.message : err}`);
  } finally {
    if (browser) await browser.close();
  }

  return races;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📅 Race Calendar Sync`);
  console.log(`──────────────────────────────`);
  console.log(`Discipline: ${discipline} | Window: ${todayStr} → ${cutoffStr} (${months} months)\n`);

  const stats: Record<string, SyncStats> = {
    road: { found: 0, inserted: 0, existed: 0, errors: 0 },
    mtb: { found: 0, inserted: 0, existed: 0, errors: 0 },
  };

  // ── Road races ──
  if (discipline === "road" || discipline === "all") {
    console.log("🚴 Road — ProCyclingStats");
    const roadRaces = await scrapePcsCalendar();
    stats.road.found = roadRaces.length;
    console.log(`  ${roadRaces.length} races in date range with eligible categories`);

    for (const race of roadRaces) {
      const result = await upsertRace(race);
      if (result === "inserted") stats.road.inserted++;
      else if (result === "existed") stats.road.existed++;
      else stats.road.errors++;
    }

    // Supplement with UCI calendar (only if PCS returned few results)
    if (roadRaces.length < 5) {
      console.log("\n🏛️  UCI Calendar (supplemental)");
      const uciRaces = await scrapeUciCalendar();
      for (const race of uciRaces) {
        stats.road.found++;
        const result = await upsertRace(race);
        if (result === "inserted") stats.road.inserted++;
        else if (result === "existed") stats.road.existed++;
        else stats.road.errors++;
      }
    }
  }

  // ── MTB races ──
  if (discipline === "mtb" || discipline === "all") {
    console.log("\n🏔️  MTB — XCOdata");
    const mtbRaces = await scrapeMtbCalendar();
    stats.mtb.found = mtbRaces.length;
    console.log(`  ${mtbRaces.length} races in date range (WC/WCH/C1)`);

    for (const race of mtbRaces) {
      const result = await upsertRace(race);
      if (result === "inserted") stats.mtb.inserted++;
      else if (result === "existed") stats.mtb.existed++;
      else stats.mtb.errors++;
    }
  }

  // ── Summary ──
  const totalNew = stats.road.inserted + stats.mtb.inserted;
  console.log(`\n──────────────────────────────`);
  console.log(
    `Road (PCS): ${stats.road.found} races found, ${stats.road.inserted} new, ${stats.road.existed} already existed`
  );
  console.log(
    `MTB (XCOdata): ${stats.mtb.found} races found, ${stats.mtb.inserted} new, ${stats.mtb.existed} already existed`
  );
  console.log(`──────────────────────────────`);
  console.log(`Total: ${totalNew} new races added\n`);

  // Print cron setup hint
  console.log(
    `Run 'openclaw cron add --name "📅 Race Calendar" --cron "0 6 * * *" --tz "Europe/Stockholm" --session isolated --message "/agents/RACE_CALENDAR.md" --timeout-seconds 300' to schedule`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
