/**
 * sync-teams.ts
 * Scrapes PCS team pages and upserts teams with proper division, country, slug.
 * Covers: WorldTour, ProTeam, Women's WorldTour/ProTeam, Continental, Women's Continental.
 *
 * Usage: npx tsx scripts/agents/sync-teams.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium } from "playwright";
import { generateEventSlug } from "../../src/lib/url-utils";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
const DRY_RUN = process.argv.includes("--dry-run");

const PAGES = [
  { url: "https://www.procyclingstats.com/teams/worldtour", division: "WorldTour", discipline: "road" },
  { url: "https://www.procyclingstats.com/teams/women", division: "Women's WorldTour", discipline: "road" },
  { url: "https://www.procyclingstats.com/teams/continental", division: "Continental", discipline: "road" },
  { url: "https://www.procyclingstats.com/teams/women-continental", division: "Women's Continental", discipline: "road" },
];

interface PCSTeam {
  name: string;
  slug: string;       // PCS slug e.g. "uae-team-emirates-2026"
  country: string;    // 3-letter ISO
  division: string;
  discipline: string;
}

function cleanSlug(pcsSlug: string): string {
  // Remove year suffix from PCS slug: "uae-team-emirates-2026" → "uae-team-emirates"
  return pcsSlug.replace(/-\d{4}$/, "");
}

async function scrapeTeamsPage(page: any, url: string, division: string, discipline: string): Promise<PCSTeam[]> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
  
  const teams = await page.evaluate((div: string, disc: string) => {
    const results: any[] = [];
    // PCS teams pages have list items with team links
    const links = document.querySelectorAll("a[href*='/team/']");
    links.forEach((el: any) => {
      const href = el.getAttribute("href") || "";
      const match = href.match(/\/team\/([a-z0-9-]+)\/?(overview)?/);
      if (!match) return;
      const pcsSlug = match[1];
      if (pcsSlug.includes("rider") || pcsSlug.includes("race")) return;
      
      const name = el.textContent?.trim();
      if (!name || name.length < 3) return;
      
      // Try to get country from nearby flag element
      const parent = el.closest("li, tr, div");
      const flag = parent?.querySelector("[class*='flag'], [class*='fi-']");
      const flagClass = flag?.className || "";
      const countryMatch = flagClass.match(/fi[- ]([a-z]{2})\b/i) || flagClass.match(/flag[- ]([a-z]{2})\b/i);
      const country = countryMatch ? countryMatch[1].toUpperCase() : "";
      
      results.push({ name, pcsSlug, country, division: div, discipline: disc });
    });
    return results;
  }, division, discipline);
  
  // Deduplicate by pcsSlug
  const seen = new Set<string>();
  return teams.filter((t: any) => {
    if (seen.has(t.pcsSlug)) return false;
    seen.add(t.pcsSlug);
    return t.name && t.name.length > 2;
  }).map((t: any) => ({
    name: t.name,
    slug: cleanSlug(t.pcsSlug),
    country: t.country,
    division: t.division,
    discipline: t.discipline,
  }));
}

// ISO 2 → 3 letter
const ISO2: Record<string, string> = {
  AE:"UAE", AT:"AUT", AU:"AUS", BE:"BEL", BR:"BRA", CA:"CAN", CH:"CHE",
  CN:"CHN", CO:"COL", CZ:"CZE", DE:"GER", DK:"DEN", ES:"ESP", FR:"FRA",
  GB:"GBR", IT:"ITA", JP:"JPN", KR:"KOR", KZ:"KAZ", NL:"NLD", NO:"NOR",
  NZ:"NZL", PL:"POL", PT:"PRT", RU:"RUS", SE:"SWE", SK:"SVK", UA:"UKR",
  US:"USA", ZA:"RSA", LU:"LUX", IE:"IRL", AT_: "AUT",
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let totalInserted = 0, totalUpdated = 0;

  for (const { url, division, discipline } of PAGES) {
    console.log(`\nScraping ${division} (${url})...`);
    try {
      const teams = await scrapeTeamsPage(page, url, division, discipline);
      console.log(`  Found ${teams.length} teams`);

      for (const team of teams) {
        const country3 = ISO2[team.country] || team.country || null;
        
        if (DRY_RUN) {
          console.log(`  ${team.division} | ${team.name} (${country3 || "?"}) → slug:${team.slug}`);
          continue;
        }

        // Upsert by slug
        const existing = await db.query.teams.findFirst({
          where: eq(schema.teams.slug, team.slug),
        });

        if (existing) {
          await db.update(schema.teams).set({
            name: team.name,
            division: team.division,
            discipline: team.discipline,
            country: country3,
          }).where(eq(schema.teams.id, existing.id));
          totalUpdated++;
        } else {
          await db.insert(schema.teams).values({
            name: team.name,
            slug: team.slug,
            division: team.division,
            discipline: team.discipline,
            country: country3,
          });
          console.log(`  + ${team.name} (${country3}) [${division}]`);
          totalInserted++;
        }
      }
    } catch (e: any) {
      console.error(`  ❌ Failed: ${e.message?.split("\n")[0]}`);
    }
  }

  await browser.close();
  console.log(`\nDone: ${totalInserted} inserted, ${totalUpdated} updated${DRY_RUN ? " [DRY RUN]" : ""}`);
}
main().catch(console.error);
