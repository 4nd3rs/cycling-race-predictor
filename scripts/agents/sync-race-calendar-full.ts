/**
 * Sync Race Calendar — Full Year
 *
 * Same logic as sync-race-calendar.ts but with:
 *   - 12-month window (full upcoming season)
 *   - No minimum category filter (include all UCI road races)
 *
 * Used for initial database population.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/agents/sync-race-calendar-full.ts [--discipline road|mtb|all]
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
import * as cheerio from "cheerio";
import { scrapeDo } from "../../src/lib/scraper/scrape-do";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const discipline = getArg("discipline", "all") as "road" | "mtb" | "all";

// Full year: 12 months, no minimum category
const months = 12;

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

/** Full year: include ALL UCI categories (no minimum filter) */
const ALL_ROAD_CATS = new Set(Object.values(UCI_ROAD_CATS));

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ScrapedRace {
  name: string;
  date: string;
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
  const cleaned = raw.trim().split("-")[0].trim().split("»")[0].trim();

  const shortMatch = cleaned.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (shortMatch) {
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    const year = today.getFullYear();
    return `${year}-${month}-${day}`;
  }

  const longMatch = cleaned.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})$/);
  if (longMatch) {
    return `${longMatch[1]}-${longMatch[2].padStart(2, "0")}-${longMatch[3].padStart(2, "0")}`;
  }

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
    const exists = await raceExists(race.name, race.date);

    if (exists) {
      if (race.pcsUrl) {
        const dateObj = new Date(race.date);
        const dayBefore = new Date(dateObj);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const dayAfter = new Date(dateObj);
        dayAfter.setDate(dayAfter.getDate() + 1);

        const dayBeforeStr = dayBefore.toISOString().split("T")[0];
        const dayAfterStr = dayAfter.toISOString().split("T")[0];

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

    const baseSlug = generateEventSlug(race.name);
    const existingSlugs = await db
      .select({ slug: schema.raceEvents.slug })
      .from(schema.raceEvents)
      .where(eq(schema.raceEvents.discipline, race.discipline));
    const slugSet = new Set(
      existingSlugs.map((e) => e.slug).filter(Boolean) as string[]
    );
    const eventSlug = makeSlugUnique(baseSlug, slugSet);

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

    if (!newEvent) return "existed";

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
  if (UCI_ROAD_CATS[lower]) return UCI_ROAD_CATS[lower];
  for (const [key, value] of Object.entries(UCI_ROAD_CATS)) {
    if (lower.includes(key)) return value;
  }
  if (lower.includes("wt") || lower.includes("worldtour")) return "WorldTour";
  return null;
}

async function scrapePcsCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];

  try {
    console.log("  Loading PCS race calendar via scrape.do...");
    const html = await scrapeDo("https://www.procyclingstats.com/races.php");
    const $ = cheerio.load(html);

    const rowsToParse: Array<{ name: string; url: string; dateRange: string; startDate: string; category: string }> = [];
    $("table tbody tr").each((_, row) => {
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      const link = $(row).find("a[href*='/race/']").first();
      if (cells.length > 2 && cells[2].length > 2) {
        rowsToParse.push({
          name: cells[2] ?? "",
          url: link.attr("href") ?? "",
          dateRange: cells[0] ?? "",
          startDate: cells[1] ?? "",
          category: cells[4] ?? "",
        });
      }
    });

    console.log(`  PCS: ${rowsToParse.length} raw rows parsed`);

    for (const row of rowsToParse) {
      try {
        const dateStr = parsePcsDate(row.startDate || row.dateRange);
        if (!dateStr || !isInDateRange(dateStr)) continue;

        const category = normalizePcsCategory(row.category || "");
        // Full year: accept ALL recognized UCI categories
        if (!category || !ALL_ROAD_CATS.has(category)) continue;

        let pcsUrl: string | undefined;
        if (row.url) {
          pcsUrl = row.url.startsWith("http")
            ? row.url
            : `https://www.procyclingstats.com/${row.url.replace(/^\//, "")}`;
        }

        races.push({
          name: row.name,
          date: dateStr,
          uciCategory: category,
          pcsUrl,
          sourceUrl: pcsUrl,
          discipline: "road",
        });
      } catch {
        // Skip bad rows
      }
    }
  } catch (err) {
    console.error(`  PCS scrape error: ${err}`);
  }

  return races;
}

// ─── MTB XCOdata Scraper ──────────────────────────────────────────────────────

async function scrapeMtbCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];

  try {
    const currentYear = today.getFullYear();
    // Full year: include all race classes (WC, HC, C1, C2, C3)
    const xcoRaces = await scrapeXCOdataRacesList(
      currentYear,
      ["WC", "WCH", "HC", "C1", "C2", "C3"],
      false
    );

    for (const xco of xcoRaces) {
      if (!isInDateRange(xco.date)) continue;

      let series: string | undefined;
      const classUpper = xco.raceClass.toUpperCase();
      if (classUpper === "WC") series = "world-cup";
      else if (classUpper === "WCH") series = "world-championships";

      races.push({
        name: xco.name,
        date: xco.date,
        country: xco.country || undefined,
        uciCategory: classUpper,
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📅 Race Calendar Sync — FULL YEAR`);
  console.log(`──────────────────────────────`);
  console.log(`Discipline: ${discipline} | Window: ${todayStr} → ${cutoffStr} (12 months)\n`);

  const stats: Record<string, SyncStats> = {
    road: { found: 0, inserted: 0, existed: 0, errors: 0 },
    mtb: { found: 0, inserted: 0, existed: 0, errors: 0 },
  };

  if (discipline === "road" || discipline === "all") {
    console.log("🚴 Road — ProCyclingStats (all categories)");
    const roadRaces = await scrapePcsCalendar();
    stats.road.found = roadRaces.length;
    console.log(`  ${roadRaces.length} races in date range`);

    for (const race of roadRaces) {
      const result = await upsertRace(race);
      if (result === "inserted") stats.road.inserted++;
      else if (result === "existed") stats.road.existed++;
      else stats.road.errors++;
    }
  }

  if (discipline === "mtb" || discipline === "all") {
    console.log("\n🏔️  MTB — XCOdata (all classes)");
    const mtbRaces = await scrapeMtbCalendar();
    stats.mtb.found = mtbRaces.length;
    console.log(`  ${mtbRaces.length} races in date range`);

    for (const race of mtbRaces) {
      const result = await upsertRace(race);
      if (result === "inserted") stats.mtb.inserted++;
      else if (result === "existed") stats.mtb.existed++;
      else stats.mtb.errors++;
    }
  }

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
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
