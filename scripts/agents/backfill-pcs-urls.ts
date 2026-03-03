/**
 * Backfill PCS URLs for upcoming road races.
 * Scrapes PCS calendar page and matches against existing races in the DB.
 */
import { db, races, raceEvents } from "./lib/db";
import { and, gte, lte, eq, isNull, asc } from "drizzle-orm";
import * as cheerio from "cheerio";

const SCRAPE_DO_TOKEN = "ad2aaefc1bf54040b26b4cdc9f477f7792fa8b9ca31";

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalize(name: string): string {
  return stripAccents(name)
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Known PCS slug overrides for races whose names don't match well
const PCS_OVERRIDES: Record<string, string> = {
  "strade bianche": "https://www.procyclingstats.com/race/strade-bianche/2026",
  "paris-nice": "https://www.procyclingstats.com/race/paris-nice/2026",
  "tirreno-adriatico": "https://www.procyclingstats.com/race/tirreno-adriatico/2026",
  "trofeo laigueglia": "https://www.procyclingstats.com/race/trofeo-laigueglia/2026",
  "ename samyn classic": "https://www.procyclingstats.com/race/le-samyn/2026",
  "nokere koerse": "https://www.procyclingstats.com/race/nokere-koerse/2026",
  "danilith nokere koerse": "https://www.procyclingstats.com/race/nokere-koerse/2026",
  "trofeo alfredo binda": "https://www.procyclingstats.com/race/trofeo-alfredo-binda-comune-di-cittiglio/2026",
};

async function scrapePcsCalendar(): Promise<Map<string, string>> {
  const nameToUrl = new Map<string, string>();

  const url = `https://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent("https://www.procyclingstats.com/races.php")}&render=true`;
  console.log("Fetching PCS calendar...");
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`scrape.do ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
    const link = $(row).find("a[href*='/race/']").first();
    if (cells.length <= 2) return;

    const raceName = cells[2] || "";
    const href = link.attr("href") ?? "";
    const pcsUrl = href
      ? (href.startsWith("http") ? href : `https://www.procyclingstats.com/${href.replace(/^\//, "")}`)
      : undefined;

    if (raceName && pcsUrl) {
      nameToUrl.set(normalize(raceName), pcsUrl);
    }
  });

  console.log(`Found ${nameToUrl.size} races on PCS`);
  return nameToUrl;
}

async function main() {
  const pcsMap = await scrapePcsCalendar();

  // Get all upcoming road races without PCS URL
  const missingRaces = await db.select({
    id: races.id,
    name: races.name,
    date: races.date,
    raceEventId: races.raceEventId,
  }).from(races)
    .where(and(
      eq(races.status, "active"),
      eq(races.discipline, "road"),
      gte(races.date, "2026-03-03"),
      lte(races.date, "2026-04-01"),
      isNull(races.pcsUrl),
    ))
    .orderBy(asc(races.date));

  console.log(`\n${missingRaces.length} road races without PCS URL`);

  let updated = 0;

  for (const race of missingRaces) {
    // Strip "- Elite Men/Women" suffix for matching
    const baseName = race.name.replace(/\s*-\s*(Elite|Junior|U23)\s*(Men|Women)$/i, "").trim();
    const normalizedBase = normalize(baseName);

    // Try overrides first
    let pcsUrl: string | undefined;
    for (const [key, url] of Object.entries(PCS_OVERRIDES)) {
      if (normalizedBase.includes(normalize(key))) {
        pcsUrl = url;
        break;
      }
    }

    // Then try PCS calendar match
    if (!pcsUrl) {
      for (const [pcsName, url] of pcsMap) {
        if (pcsName.includes(normalizedBase) || normalizedBase.includes(pcsName)) {
          pcsUrl = url;
          break;
        }
      }
    }

    if (pcsUrl) {
      await db.update(races).set({ pcsUrl }).where(eq(races.id, race.id));
      updated++;
      console.log(`  ✓ ${race.name} → ${pcsUrl}`);
    }
  }

  console.log(`\nDone: ${updated} races updated with PCS URLs`);
}

main().catch(console.error);
