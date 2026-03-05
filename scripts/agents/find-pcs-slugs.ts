/**
 * find-pcs-slugs.ts
 * Discovers PCS URLs for road races missing pcs_url.
 *
 * Usage:
 *   tsx scripts/agents/find-pcs-slugs.ts
 *   tsx scripts/agents/find-pcs-slugs.ts --dry-run
 *   tsx scripts/agents/find-pcs-slugs.ts --days-back=14 --days-ahead=30
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "./lib/db";
import * as schema from "../../src/lib/db/schema";
import { and, gte, lte, eq, isNull, asc } from "drizzle-orm";
import * as cheerio from "cheerio";
import { scrapeDo } from "../../src/lib/scraper/scrape-do";

const DRY_RUN = process.argv.includes("--dry-run");
const DAYS_BACK  = Number(process.argv.find(a => a.startsWith("--days-back="))?.split("=")[1]  ?? 7);
const DAYS_AHEAD = Number(process.argv.find(a => a.startsWith("--days-ahead="))?.split("=")[1] ?? 30);
const DELAY_MS = 900;

// Race name fragments that are definitely not on PCS — skip immediately
const NOT_ON_PCS = ["national championships bolivia", "grand prix de la dodecanese", "tour des 100 communes", "grand prix apollon", "vuelta a extremadura"];

// ---------------------------------------------------------------------------
// Sponsor prefixes to strip
// ---------------------------------------------------------------------------
const SPONSOR_PREFIXES: RegExp[] = [
  /^fenix[\s\-–]+ek[oö]i[\s\-–]+/i,
  /^faun[\s\-–]+/i,
  /^beobank[\s\-–]+/i,
  /^danilith[\s\-–]+/i,
  /^biwase[\s\-–]+/i,
  /^salverda[\s\-–]+bouw[\s\-–]+/i,
  /^unibet[\s\-–]+/i,
  /^decathlon[\s\-–]+ag2r[\s\-–]+/i,
  /^lidl[\s\-–]+/i,
  /^alé[\s\-–]+/i,
  /^elite[\s\-–]+/i,
];

// Hard overrides: normalized name → PCS slug (no year, no domain)
const SLUG_OVERRIDES: Record<string, string> = {
  "omloop van het hageland":          "omloop-van-het-hageland",
  "drome classic":                    "la-drome-classic",
  "faun drome classic":               "la-drome-classic",
  "la drome classic":                 "la-drome-classic",
  "tour de la provence":              "tour-de-la-provence",
  "ster van zwolle":                  "ster-van-zwolle",
  "salverda bouw ster van zwolle":    "ster-van-zwolle",
  "tour of vietnam":                  "biwase-tour-of-vietnam",
  "biwase tour of vietnam":           "biwase-tour-of-vietnam",
  "grand prix de la dodecanese":      "grand-prix-de-la-dodecanese",
  "rhodes gp":                        "grand-prix-de-la-dodecanese",
  "omloop het nieuwsblad":            "omloop-het-nieuwsblad",
  "milano sanremo":                   "milano-sanremo",
  "beobank samyn ladies":             "le-samyn-des-dames",
  "samyn ladies":                     "le-samyn-des-dames",
  "le samyn":                         "le-samyn",
  "trofeo alfredo binda":             "trofeo-alfredo-binda-comune-di-cittiglio",
  "vuelta extremadura femenina":      "vuelta-a-extremadura-femenina",
  "vuelta a extremadura femenina":    "vuelta-a-extremadura-femenina",
  "grand prix apollon temple":        "grand-prix-apollon-temple",
  "umag classic":                     "umag-classic",
};

// Women's URL suffixes to try (in priority order)
const WOMENS_SUFFIXES = ["-we", "-donne", "-femmes", "-ladies", "-dames", "-women", "-femenina"];

// ---------------------------------------------------------------------------

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(s: string) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalize(s: string) {
  return stripAccents(s).toLowerCase().trim();
}

function stripSponsor(name: string) {
  let n = name;
  for (const re of SPONSOR_PREFIXES) n = n.replace(re, "");
  return n.trim();
}

function stripCategory(name: string) {
  return name.replace(/\s*[-–|]\s*(elite|u23|under\s*23|junior|men|women|masculin|feminin).*$/i, "").trim();
}

function getBaseSlug(rawName: string): string {
  const clean = stripCategory(stripSponsor(rawName));
  const norm  = normalize(clean);

  for (const [key, slug] of Object.entries(SLUG_OVERRIDES)) {
    if (norm === key || norm.includes(key) || key.includes(norm)) return slug;
  }

  return slugify(clean);
}

function getCandidates(rawName: string, gender: string, year: string): string[] {
  const base = getBaseSlug(rawName);
  if (!base) return [];
  const root = `https://www.procyclingstats.com/race`;

  if (gender === "women") {
    return [
      ...WOMENS_SUFFIXES.map(s => `${root}/${base}${s}/${year}`),
      `${root}/${base}/${year}`,          // fallback: shared page
    ];
  }
  return [`${root}/${base}/${year}`];
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function probeUrl(url: string): Promise<number> {
  try {
    const html = await scrapeDo(url, { render: false, timeout: 18000 });
    if (html.length < 500) return 0;
    const lo = html.toLowerCase();
    if (lo.includes("page not found") || lo.includes("not found</title>") || lo.includes("404")) return 0;
    const $ = cheerio.load(html);
    return $('a[href*="rider/"]').length;
  } catch {
    return 0;
  }
}

async function main() {
  const today = new Date();
  const from  = new Date(today); from.setDate(from.getDate() - DAYS_BACK);
  const to    = new Date(today); to.setDate(to.getDate() + DAYS_AHEAD);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = to.toISOString().slice(0, 10);

  console.log(`🔍 Finding PCS slugs for road races ${fromStr} → ${toStr}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  const rows = await db
    .select({ id: schema.races.id, name: schema.races.name, date: schema.races.date, gender: schema.races.gender })
    .from(schema.races)
    .where(and(
      gte(schema.races.date, fromStr),
      lte(schema.races.date, toStr),
      eq(schema.races.status, "active"),
      eq(schema.races.discipline, "road"),
      isNull(schema.races.pcsUrl),
    ))
    .orderBy(asc(schema.races.date));

  console.log(`${rows.length} races without pcs_url\n`);

  let found = 0, notFound = 0;

  for (const race of rows) {
    const year = (race.date as string).slice(0, 4);
    const candidates = getCandidates(race.name, race.gender ?? "men", year);

    console.log(`\n🔎 ${(race.date as string).slice(0,10)} | ${race.gender} | ${race.name}`);
    console.log(`   slug → ${getBaseSlug(race.name)}`);

    const normName = normalize(race.name);
    if (NOT_ON_PCS.some(skip => normName.includes(skip))) {
      console.log(`   ⏭  not on PCS (skip list)`);
      notFound++;
      continue;
    }

    if (!candidates.length) { console.log(`   ⏭  no slug`); notFound++; continue; }

    let matched: string | null = null;

    for (const candidate of candidates) {
      await sleep(DELAY_MS);
      const count = await probeUrl(candidate);
      const mark = count > 5 ? "✅" : count > 0 ? "⚠️ " : "❌";
      console.log(`   ${mark} ${candidate.replace("https://www.procyclingstats.com/race/", "")} → ${count} rider links`);
      if (count > 5) { matched = candidate; break; }
    }

    if (matched) {
      found++;
      if (DRY_RUN) {
        console.log(`   [dry] pcs_url = ${matched}`);
      } else {
        await db.update(schema.races).set({ pcsUrl: matched }).where(eq(schema.races.id, race.id));
        console.log(`   💾 Saved!`);
      }
    } else {
      notFound++;
      console.log(`   ⚠️  Not found on PCS`);
    }
  }

  console.log(`\n✅ Done: ${found} found, ${notFound} not found`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
