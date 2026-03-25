import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { db, raceEvents, races } from "@/lib/db";
import { and, eq, gte, lte, ilike } from "drizzle-orm";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "@/lib/url-utils";
import { scrapeXCOdataRacesList } from "@/lib/scraper/xcodata-races";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";

export const maxDuration = 60;

// ── Constants ─────────────────────────────────────────────────────────────────

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

const MIN_ROAD_CATS = new Set([
  "WorldTour", "2.Pro", "1.Pro", "2.HC", "1.HC", "1.1",
]);

const BLOCKED_PCS_SLUGS = new Set([
  "omloop-het-nieuwsblad", "omloop-nieuwsblad", "omloop-nieuwsblad-me",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Date helpers ──────────────────────────────────────────────────────────────

function parsePcsDate(raw: string, currentYear: number): string | null {
  const cleaned = raw.trim().split("-")[0].trim().split("»")[0].trim();

  const shortMatch = cleaned.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (shortMatch) {
    return `${currentYear}-${shortMatch[2].padStart(2, "0")}-${shortMatch[1].padStart(2, "0")}`;
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
    if (month) return `${textMatch[3]}-${month}-${textMatch[1].padStart(2, "0")}`;
  }

  return null;
}

function normalizePcsCategory(raw: string): string | null {
  const lower = raw.toLowerCase().replace(/\s+/g, "").trim();
  if (UCI_ROAD_CATS[lower]) return UCI_ROAD_CATS[lower];
  for (const [key, value] of Object.entries(UCI_ROAD_CATS)) {
    if (lower.includes(key)) return value;
  }
  if (lower.includes("uwt") || lower.includes("wt") || lower.includes("worldtour")) return "WorldTour";
  if (lower.includes("pro")) return lower.startsWith("2") ? "2.Pro" : "1.Pro";
  return null;
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

async function raceExists(name: string, dateStr: string): Promise<boolean> {
  const dateObj = new Date(dateStr);
  const dayBefore = new Date(dateObj); dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(dateObj); dayAfter.setDate(dayAfter.getDate() + 1);
  const dayBeforeStr = dayBefore.toISOString().split("T")[0];
  const dayAfterStr = dayAfter.toISOString().split("T")[0];

  const [existingEvent] = await db
    .select({ id: raceEvents.id })
    .from(raceEvents)
    .where(and(ilike(raceEvents.name, `%${name}%`), gte(raceEvents.date, dayBeforeStr), lte(raceEvents.date, dayAfterStr)))
    .limit(1);
  if (existingEvent) return true;

  const [existingRace] = await db
    .select({ id: races.id })
    .from(races)
    .where(and(ilike(races.name, `%${name}%`), gte(races.date, dayBeforeStr), lte(races.date, dayAfterStr)))
    .limit(1);
  return !!existingRace;
}

// ── Category parsing ─────────────────────────────────────────────────────────

const WOMEN_KEYWORDS = /\b(women|woman|femmes?|f[eé]minin[ea]?s?|donne|ladies|dames?)\b|(?:^|\s)(WE|WJ|WU)(?:\s|$)/i;

function parseRaceCategories(name: string): Array<{ gender: string; ageCategory: string; cleanName: string }> {
  const ageMap: Record<string, string> = { E: "elite", U: "u23", J: "junior" };
  const genderMap: Record<string, string> = { M: "men", W: "women" };

  // Match short codes like ME, WE, MU, WU, MJ, WJ as standalone tokens
  const tokens = name.toUpperCase().split(/[\s\-_|]+/);
  const shortCodes = ["ME", "WE", "MU", "WU", "MJ", "WJ"];
  const found = tokens.filter(t => shortCodes.includes(t));

  if (found.length > 0) {
    let cleanName = name
      .replace(/\s*[-–]?\s*(ME|WE|MU|WU|MJ|WJ)\b/gi, "")
      .replace(/\s*[-–]\s*(Elite|U23|Junior)\s*(Men|Women|Man|Woman)\s*$/i, "")
      .replace(/\s*[-–]\s*(Men|Women)\s*(Elite|U23|Junior)\s*$/i, "")
      .replace(/\s+/g, " ").trim();
    return [...new Set(found)].map(code => ({
      gender: genderMap[code[0]] ?? "men",
      ageCategory: ageMap[code[1]] ?? "elite",
      cleanName,
    }));
  }

  // Detect explicitly gendered race names
  if (WOMEN_KEYWORDS.test(name)) {
    return [{ gender: "women", ageCategory: "elite", cleanName: name }];
  }

  // No gender marker → men-only (women's races on PCS always have explicit indicator)
  return [{ gender: "men", ageCategory: "elite", cleanName: name }];
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertRace(race: ScrapedRace): Promise<"inserted" | "existed" | "error"> {
  try {
    const categories = parseRaceCategories(race.name);
    const eventName = categories[0].cleanName;

    const exists = await raceExists(eventName, race.date);
    if (exists) {
      // Backfill pcsUrl on existing races if missing
      if (race.pcsUrl) {
        const dateObj = new Date(race.date);
        const dayBefore = new Date(dateObj); dayBefore.setDate(dayBefore.getDate() - 1);
        const dayAfter = new Date(dateObj); dayAfter.setDate(dayAfter.getDate() + 1);
        const matchingRaces = await db
          .select({ id: races.id, pcsUrl: races.pcsUrl })
          .from(races)
          .where(and(
            ilike(races.name, `%${eventName}%`),
            gte(races.date, dayBefore.toISOString().split("T")[0]),
            lte(races.date, dayAfter.toISOString().split("T")[0])
          ));
        for (const r of matchingRaces) {
          if (!r.pcsUrl) await db.update(races).set({ pcsUrl: race.pcsUrl }).where(eq(races.id, r.id));
        }
      }
      return "existed";
    }

    const baseSlug = generateEventSlug(eventName);
    if (BLOCKED_PCS_SLUGS.has(baseSlug)) return "existed";

    const existingSlugs = await db
      .select({ slug: raceEvents.slug })
      .from(raceEvents)
      .where(eq(raceEvents.discipline, race.discipline));
    const slugSet = new Set(existingSlugs.map(e => e.slug).filter(Boolean) as string[]);
    const eventSlug = makeSlugUnique(baseSlug, slugSet);

    const [newEvent] = await db
      .insert(raceEvents)
      .values({
        name: eventName, slug: eventSlug, date: race.date,
        endDate: race.endDate || null, discipline: race.discipline,
        subDiscipline: race.subDiscipline || null, country: race.country || null,
        sourceUrl: race.sourceUrl || race.pcsUrl || null,
        sourceType: race.pcsUrl ? "pcs" : "agent",
        series: race.series || null,
      })
      .onConflictDoNothing()
      .returning();

    if (!newEvent) return "existed";

    for (const cat of categories) {
      const categorySlug = generateCategorySlug(cat.ageCategory, cat.gender);
      const genderLabel = cat.gender.charAt(0).toUpperCase() + cat.gender.slice(1);
      const ageLabelMap: Record<string, string> = { elite: "Elite", u23: "U23", junior: "Junior" };
      const ageLabel = ageLabelMap[cat.ageCategory] ?? "Elite";
      await db.insert(races).values({
        name: `${cat.cleanName} - ${ageLabel} ${genderLabel}`,
        categorySlug, date: race.date, endDate: race.endDate || null,
        discipline: race.discipline,
        raceType: race.subDiscipline || (race.endDate ? "stage_race" : "one_day"),
        ageCategory: cat.ageCategory, gender: cat.gender,
        uciCategory: race.uciCategory || null, country: race.country || null,
        raceEventId: newEvent.id, pcsUrl: race.pcsUrl || null, status: "active",
      }).onConflictDoNothing();
    }

    return "inserted";
  } catch (err) {
    console.error(`[sync-race-calendar] Error upserting "${race.name}": ${err}`);
    return "error";
  }
}

// ── PCS Calendar ──────────────────────────────────────────────────────────────

async function scrapePcsCalendar(todayStr: string, cutoffStr: string): Promise<ScrapedRace[]> {
  const currentYear = new Date().getFullYear();
  const results: ScrapedRace[] = [];

  try {
    const html = await scrapeDo("https://www.procyclingstats.com/races.php");
    const $ = cheerio.load(html);

    $("table tbody tr").each((_, row) => {
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      const link = $(row).find("a[href*='/race/']").first();
      if (cells.length <= 2 || cells[2].length <= 2) return;

      const dateStr = parsePcsDate(cells[1] || cells[0], currentYear);
      if (!dateStr || dateStr < todayStr || dateStr > cutoffStr) return;

      const category = normalizePcsCategory(cells[4] || "");
      if (!category || !MIN_ROAD_CATS.has(category)) return;

      const url = link.attr("href") ?? "";
      const pcsUrl = url
        ? (url.startsWith("http") ? url : `https://www.procyclingstats.com/${url.replace(/^\//, "")}`)
        : undefined;

      results.push({
        name: cells[2], date: dateStr, uciCategory: category,
        pcsUrl, sourceUrl: pcsUrl, discipline: "road",
      });
    });
  } catch (err) {
    console.error(`[sync-race-calendar] PCS scrape error: ${err}`);
  }

  return results;
}

// ── MTB Calendar ──────────────────────────────────────────────────────────────

async function scrapeMtbCalendar(todayStr: string, cutoffStr: string): Promise<ScrapedRace[]> {
  const results: ScrapedRace[] = [];

  try {
    const html = await fetch("https://www.xcodata.com/races", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Bot/1.0)" },
      signal: AbortSignal.timeout(20000),
    }).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); });

    const $ = cheerio.load(html);
    const monthMap: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };

    function parseXcoDate(raw: string): string | null {
      const parts = raw.replace(/\s*-\s*\d+/, "").trim().split(/\s+/);
      if (parts.length < 3) return null;
      const day = parts[0].padStart(2, "0");
      const month = monthMap[parts[1].toLowerCase().substring(0, 3)];
      const year = parts[2] || parts[parts.length - 1];
      if (!month || !year) return null;
      return `${year}-${month}-${day}`;
    }

    const TARGET_CLASSES = new Set(["WC", "WCH", "C1", "C2"]);
    const XCC_CLASSES = new Set(["WC", "WCH", "C1", "C2", "C3", "HC"]);

    $("table tbody tr").each((_, tr) => {
      const cells = $(tr).find("td").map((__, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
      const link = $(tr).find("a").first();
      const href = link.attr("href") ?? "";
      let raceName = link.text().replace(/\s+/g, " ").trim();
      const dateMatch = raceName.match(/\d{1,2}(?:\s*-\s*\d{1,2})?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
      if (dateMatch) raceName = raceName.substring(0, dateMatch.index).trim();
      raceName = raceName.replace(/\s+Winner.*$/i, "").trim();

      if (raceName.length <= 3 || raceName.length >= 200) return;

      const dateStr = parseXcoDate(cells[0] ?? "");
      if (!dateStr || dateStr < todayStr || dateStr > cutoffStr) return;

      const classCode = (cells[cells.length - 1] ?? "").toUpperCase().trim();
      const isXCC = /XCC/i.test(raceName);
      const allowedClasses = isXCC ? XCC_CLASSES : TARGET_CLASSES;
      if (!allowedClasses.has(classCode)) return;

      const name = raceName.replace(/\s*[-–]\s*XC[CO]\s*$/, "").trim();
      let series: string | undefined;
      if (classCode === "WC") series = "world-cup";
      else if (classCode === "WCH") series = "world-championships";

      const sourceUrl = href ? (href.startsWith("http") ? href : `https://www.xcodata.com${href}`) : undefined;

      results.push({
        name, date: dateStr, uciCategory: classCode,
        sourceUrl, discipline: "mtb",
        subDiscipline: isXCC ? "xcc" : "xco", series,
      });
    });
  } catch (err) {
    console.error(`[sync-race-calendar] XCOdata scrape error: ${err}`);
  }

  return results;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 3 months
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const stats = { road: { found: 0, inserted: 0, existed: 0, errors: 0 }, mtb: { found: 0, inserted: 0, existed: 0, errors: 0 } };

    // Road
    const roadRaces = await scrapePcsCalendar(todayStr, cutoffStr);
    stats.road.found = roadRaces.length;
    for (const race of roadRaces) {
      const r = await upsertRace(race);
      if (r === "inserted") stats.road.inserted++;
      else if (r === "existed") stats.road.existed++;
      else stats.road.errors++;
    }

    // MTB
    const mtbRaces = await scrapeMtbCalendar(todayStr, cutoffStr);
    stats.mtb.found = mtbRaces.length;
    for (const race of mtbRaces) {
      const r = await upsertRace(race);
      if (r === "inserted") stats.mtb.inserted++;
      else if (r === "existed") stats.mtb.existed++;
      else stats.mtb.errors++;
    }

    return NextResponse.json({
      success: true,
      road: stats.road,
      mtb: stats.mtb,
      totalNew: stats.road.inserted + stats.mtb.inserted,
    });
  } catch (error) {
    console.error("[cron/sync-race-calendar]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
