/**
 * enrich-race-meta.ts
 * Fetches XCOdata race detail pages for all upcoming MTB race_events and updates:
 *   - race_events.country (ISO 3-letter)
 *   - races.uci_category (from page title: "Race Name (C2)")
 *   - race_events.slug (fix bad slugs with dates/locations embedded)
 *
 * Usage: npx tsx scripts/agents/enrich-race-meta.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, isNotNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { generateEventSlug } from "../../src/lib/url-utils";
import { chromium } from "playwright";


const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
const DRY_RUN = process.argv.includes("--dry-run");

const ISO2_TO_3: Record<string, string> = {
  SE:"SWE", FR:"FRA", ES:"ESP", IT:"ITA", DE:"GER", AT:"AUT",
  CH:"CHE", NL:"NLD", BE:"BEL", NO:"NOR", DK:"DEN", FI:"FIN",
  CZ:"CZE", SK:"SVK", PL:"POL", HU:"HUN", HR:"HRV", RS:"SRB",
  SI:"SVN", PT:"PRT", GB:"GBR", US:"USA", CA:"CAN", BR:"BRA",
  AR:"ARG", CL:"CHL", CO:"COL", ZA:"RSA", NA:"NAM", IN:"IND",
  JP:"JPN", AU:"AUS", NZ:"NZL", CN:"CHN", IL:"ISR", UA:"UKR",
  RO:"ROU", BG:"BUL", TR:"TUR", CR:"CRC",
};

const COUNTRY_TEXT: Record<string, string> = {
  "sweden":"SWE","france":"FRA","spain":"ESP","italy":"ITA","germany":"GER","austria":"AUT",
  "switzerland":"CHE","netherlands":"NLD","belgium":"BEL","norway":"NOR","denmark":"DEN",
  "finland":"FIN","czech republic":"CZE","czechia":"CZE","slovakia":"SVK","poland":"POL",
  "hungary":"HUN","croatia":"HRV","serbia":"SRB","slovenia":"SVN","portugal":"PRT",
  "great britain":"GBR","united states":"USA","canada":"CAN","brazil":"BRA","argentina":"ARG",
  "chile":"CHL","colombia":"COL","south africa":"RSA","namibia":"NAM","india":"IND",
  "japan":"JPN","australia":"AUS","new zealand":"NZL","china":"CHN","israel":"ISR",
};

function parseCountry(html: string): string | null {
  // xcodata uses CSS flag sprites: class="flag-se" or similar
  const m = html.match(/\bflag[_-]([a-z]{2})\b/i);
  if (m) return ISO2_TO_3[m[1].toUpperCase()] ?? null;
  // alt text like <img alt="Sweden"
  const alt = html.match(/alt="([A-Za-z ]+?)"/g);
  if (alt) {
    for (const a of alt) {
      const name = a.replace(/alt="|"/g, "").toLowerCase();
      if (COUNTRY_TEXT[name]) return COUNTRY_TEXT[name];
    }
  }
  // text match
  const lower = html.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_TEXT)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

function parseCategoryFromTitle(title: string): string | null {
  const m = title.match(/\(([A-Z][A-Z0-9]*)\)\s*[|\-]/);
  return m ? m[1] : null;
}

function needsSlugFix(slug: string): boolean {
  return /\d{4}|winner|sater|saeter|\bjun\b|\bfeb\b|\bmar\b|\bapr\b|\bmay\b/i.test(slug);
}

async function main() {
  const today = new Date().toISOString().split("T")[0];

  const events = await db.query.raceEvents.findMany({
    where: isNotNull(schema.raceEvents.sourceUrl),
    with: { races: true },
  });

  const xcoEvents = events.filter(e =>
    e.sourceUrl?.includes("xcodata") &&
    e.races.some(r => r.date && new Date(r.date) >= new Date(today))
  );

  console.log(`Found ${xcoEvents.length} upcoming XCOdata events\n`);

  const browser = await chromium.launch({ headless: true });
  let updated = 0, skipped = 0, failed = 0;

  for (const event of xcoEvents) {
    const url = event.sourceUrl!;
    const raceDate = event.races[0]?.date ? new Date(event.races[0].date).toISOString().substring(0,10) : "?";
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title = await page.title();
      const html = await page.content();
      await page.close();

      const newCategory = parseCategoryFromTitle(title);
      const newCountry = parseCountry(html);
      const newSlug = needsSlugFix(event.slug ?? "") ? generateEventSlug(event.name) : null;

      const changes: string[] = [];
      if (newCategory) changes.push(`cat:${newCategory}`);
      if (newCountry && !event.country) changes.push(`country:${newCountry}`);
      if (newSlug) changes.push(`slug:${newSlug}`);

      if (!changes.length) {
        process.stdout.write(".");
        skipped++;
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      console.log(`\n✅ ${event.name} (${raceDate}) → ${changes.join(", ")}`);

      if (!DRY_RUN) {
        const eventUpd: Record<string, any> = {};
        if (newCountry && !event.country) eventUpd.country = newCountry;
        if (newSlug) eventUpd.slug = newSlug;
        if (Object.keys(eventUpd).length)
          await db.update(schema.raceEvents).set(eventUpd).where(eq(schema.raceEvents.id, event.id));

        for (const race of event.races) {
          const raceUpd: Record<string, any> = {};
          if (newCategory) raceUpd.uciCategory = newCategory;
          if (newCountry) raceUpd.country = newCountry;
          if (Object.keys(raceUpd).length)
            await db.update(schema.races).set(raceUpd).where(eq(schema.races.id, race.id));
        }
      }
      updated++;
      await new Promise(r => setTimeout(r, 400));
    } catch (e: any) {
      console.error(`\n❌ ${event.name}: ${e.message?.split("\n")[0]}`);
      failed++;
    }
  }

  await browser.close();
  console.log(`\n\nDone: ${updated} updated, ${skipped} skipped (no changes), ${failed} failed${DRY_RUN ? " [DRY RUN]" : ""}`);
}
main().catch(console.error);
