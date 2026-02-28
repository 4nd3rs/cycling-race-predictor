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
import * as cheerio from "cheerio";
import { writeScrapeStatus } from "./lib/scrape-status";
import { normalizeCountry } from "./lib/normalize";

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


/** PCS slugs that are known duplicates/aliases — never import these */
const BLOCKED_PCS_SLUGS = new Set([
  "omloop-het-nieuwsblad",   // canonical slug — we store it as omloop-het-nieuwsblad-2026
  "omloop-nieuwsblad",       // alias, creates duplicate
  "omloop-nieuwsblad-me",    // alias, creates duplicate
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
    // Skip known duplicate/alias slugs  
    if (BLOCKED_PCS_SLUGS.has(baseSlug)) {
      console.log(`  ⊘ Skipped blocked slug: ${baseSlug} (${race.name})`);
      return "existed";
    }
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
        country: normalizeCountry(race.country) ?? null,
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
          country: normalizeCountry(race.country) ?? null,
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
  // WT / UWT shorthand
  if (lower.includes("uwt") || lower.includes("wt") || lower.includes("worldtour")) return "WorldTour";
  // Pro series
  if (lower.includes("pro")) return lower.startsWith("2") ? "2.Pro" : "1.Pro";
  return null;
}

async function scrapePcsCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];

  try {
    const token = process.env.SCRAPE_DO_TOKEN;
    if (!token) throw new Error("SCRAPE_DO_TOKEN not set");
    const apiUrl = `https://api.scrape.do?token=${token}&url=${encodeURIComponent("https://www.procyclingstats.com/races.php")}&render=true`;

    console.log("  Loading PCS race calendar via scrape.do...");
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`scrape.do returned ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const rowsToParse: Array<{ name: string; url: string; dateRange: string; startDate: string; category: string }> = [];
    $("table tbody tr").each((_, row) => {
      const cells = $(row).find("td").map((_, td) => $(td).text().trim()).get();
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
  }

  return races;
}

// ─── MTB XCOdata Scraper ──────────────────────────────────────────────────────

async function scrapeMtbCalendar(): Promise<ScrapedRace[]> {
  const races: ScrapedRace[] = [];

  try {
    // XCOdata is not behind Cloudflare — plain fetch works
    console.log("  Loading XCOdata race calendar...");
    const res = await fetch("https://www.xcodata.com/races", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Bot/1.0)", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`XCOdata returned ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // XCOdata table: each row has [date cell, race card cell, ..., class cell]
    // Race card is wrapped in an <a> tag containing the race name + date + location
    const rows: Array<{ date: string; name: string; raceClass: string; url: string }> = [];
    $("table tbody tr").each((_, tr) => {
      const cells = $(tr).find("td").map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
      const link = $(tr).find("a").first();
      const href = link.attr("href") ?? "";

      // Extract race name: first <a> text, trimmed before date pattern
      let raceName = link.text().replace(/\s+/g, " ").trim();
      const dateMatch = raceName.match(/\d{1,2}(?:\s*-\s*\d{1,2})?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
      if (dateMatch) raceName = raceName.substring(0, dateMatch.index).trim();
      raceName = raceName.replace(/\s+Winner.*$/i, "").trim();

      if (raceName.length > 3 && raceName.length < 200) {
        rows.push({
          date: cells[0] ?? "",
          name: raceName,
          raceClass: cells[cells.length - 1] ?? "",
          url: href,
        });
      }
    });

    // Parse XCOdata dates like "24 Jan 2026" or "28 - 30 Jan 2026"
    const monthMap: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    function parseXcoDate(raw: string): string | null {
      // "28 - 30 Jan 2026" or "24 Jan 2026"
      const parts = raw.replace(/\s*-\s*\d+/, "").trim().split(/\s+/);
      if (parts.length < 3) return null;
      const day = parts[0].padStart(2, "0");
      const month = monthMap[parts[1].toLowerCase().substring(0,3)];
      const year = parts[2] || parts[parts.length - 1];
      if (!month || !year) return null;
      return `${year}-${month}-${day}`;
    }

    const TARGET_CLASSES = new Set(["WC", "WCH", "C1", "C2"]);
    // XCC races use C3 as their equivalent of C1; accept them when name contains XCC
    const XCC_CLASSES = new Set(["WC", "WCH", "C1", "C2", "C3", "HC"]);

    for (const row of rows) {
      const dateStr = parseXcoDate(row.date);
      if (!dateStr || !isInDateRange(dateStr)) continue;

      const classCode = row.raceClass.toUpperCase().trim();
      const isXCC = /XCC/i.test(row.name);
      const allowedClasses = isXCC ? XCC_CLASSES : TARGET_CLASSES;
      if (!allowedClasses.has(classCode)) continue;

      // Clean name: remove XCO/XCC suffix
      const name = row.name.replace(/\s*[-–]\s*XC[CO]\s*$/, "").trim();

      let series: string | undefined;
      if (classCode === "WC") series = "world-cup";
      else if (classCode === "WCH") series = "world-championships";

      const sourceUrl = row.url
        ? (row.url.startsWith("http") ? row.url : `https://www.xcodata.com${row.url}`)
        : undefined;

      races.push({
        name,
        date: dateStr,
        uciCategory: classCode,
        sourceUrl,
        discipline: "mtb",
        subDiscipline: isXCC ? "xcc" : "xco",
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

  try {
    const token = process.env.SCRAPE_DO_TOKEN;
    if (!token) throw new Error("SCRAPE_DO_TOKEN not set");

    console.log("  Loading UCI official calendar (optional) via scrape.do...");
    const apiUrl = `https://api.scrape.do?token=${token}&url=${encodeURIComponent("https://www.uci.org/calendar")}&render=true`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`scrape.do returned ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try to extract any visible race entries
    const uciRaces: Array<{ name: string; date: string; country: string }> = [];
    $(".calendar-list-item, .event-row, [class*='event']").each((_, item) => {
      const name = $(item).find("h3, .event-name, .title").first().text().trim();
      const date = $(item).find("time, .date, [class*='date']").first().text().trim();
      const country = $(item).find(".country, [class*='country']").first().text().trim();
      if (name) uciRaces.push({ name, date, country });
    });

    console.log(`  UCI: ${uciRaces.length} entries found`);

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

  // Write pipeline status
  writeScrapeStatus({
    component: "calendar",
    status: totalNew > 0 ? "ok" : stats.road.errors + stats.mtb.errors > 0 ? "warn" : "ok",
    summary: `Road (PCS): ${stats.road.found} found, ${stats.road.inserted} new, ${stats.road.existed} existed. MTB (XCOdata): ${stats.mtb.found} found, ${stats.mtb.inserted} new, ${stats.mtb.existed} existed.`,
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
