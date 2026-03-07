import { chromium } from "playwright";

const RACES: { slug: string; pcsSlug: string; years: number[] }[] = [
  { slug: "OMLOOP", pcsSlug: "omloop-het-nieuwsblad", years: [2025,2024,2023,2022,2021] },
  { slug: "STRADE_BIANCHE", pcsSlug: "strade-bianche", years: [2025,2024,2023,2022,2021] },
  { slug: "MILAN_SANREMO", pcsSlug: "milano-sanremo", years: [2025,2024,2023,2022,2021] },
  { slug: "TOUR_OF_FLANDERS", pcsSlug: "ronde-van-vlaanderen", years: [2025,2024,2023,2022,2021] },
  { slug: "PARIS_ROUBAIX", pcsSlug: "paris-roubaix", years: [2024,2023,2022,2021,2020] },
  { slug: "AMSTEL_GOLD", pcsSlug: "amstel-gold-race", years: [2025,2024,2023,2022,2021] },
  { slug: "LA_FLECHE_WALLONNE", pcsSlug: "la-fleche-wallonne", years: [2025,2024,2023,2022,2021] },
  { slug: "LBL", pcsSlug: "liege-bastogne-liege", years: [2025,2024,2023,2022,2021] },
  { slug: "IL_LOMBARDIA", pcsSlug: "il-lombardia", years: [2024,2023,2022,2021,2020] },
  { slug: "PARIS_NICE", pcsSlug: "paris-nice", years: [2025,2024,2023,2022,2021] },
  { slug: "TIRRENO_ADRIATICO", pcsSlug: "tirreno-adriatico", years: [2025,2024,2023,2022,2021] },
  { slug: "CRITERIUM_DU_DAUPHINE", pcsSlug: "criterium-du-dauphine", years: [2024,2023,2022,2021,2020] },
  { slug: "TOUR_DE_SUISSE", pcsSlug: "tour-de-suisse", years: [2024,2023,2022,2021,2020] },
  { slug: "DWARS_DOOR_VLAANDEREN", pcsSlug: "dwars-door-vlaanderen", years: [2025,2024,2023,2022,2021] },
  { slug: "GENT_WEVELGEM", pcsSlug: "gent-wevelgem", years: [2025,2024,2023,2022,2021] },
  { slug: "E3_SAXO", pcsSlug: "e3-saxo-classic", years: [2025,2024,2023,2022,2021] },
  { slug: "GIRO_DITALIA", pcsSlug: "giro-d-italia", years: [2024,2023,2022,2021,2020] },
  { slug: "TOUR_DE_FRANCE", pcsSlug: "tour-de-france", years: [2024,2023,2022,2021,2020] },
  { slug: "VUELTA", pcsSlug: "vuelta-a-espana", years: [2024,2023,2022,2021,2020] },
];

async function scrapeWinner(page: any, pcsSlug: string, year: number): Promise<{ name: string; team: string } | null> {
  try {
    const url = `https://www.procyclingstats.com/race/${pcsSlug}/${year}/result`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1500);

    // Get first row of results table
    const row = await page.$("table.results tbody tr:first-child");
    if (!row) return null;

    const name = await row.$eval("td a[href*='/rider/']", (el: any) => el.textContent.trim()).catch(() => null);
    const team = await row.$eval("td a[href*='/team/']", (el: any) => el.textContent.trim()).catch(() => "");

    if (!name) return null;
    // Convert PCS format "VAN DER POEL Mathieu" → "Mathieu van der Poel"
    const parts = name.split(" ");
    const last = parts.slice(0, -1).map((p: string) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
    const first = parts[parts.length - 1];
    const fullName = `${first} ${last}`;
    return { name: fullName, team };
  } catch { return null; }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" });

  const results: Record<string, { year: number; name: string; team: string }[]> = {};

  for (const race of RACES) {
    console.log(`\nScraping ${race.pcsSlug}...`);
    results[race.slug] = [];
    for (const year of race.years) {
      const winner = await scrapeWinner(page, race.pcsSlug, year);
      if (winner) {
        results[race.slug].push({ year, ...winner });
        console.log(`  ${year}: ${winner.name} (${winner.team})`);
      } else {
        console.log(`  ${year}: not found`);
      }
      await page.waitForTimeout(800);
    }
  }

  await browser.close();

  // Output as TypeScript pastWinners arrays
  console.log("\n\n=== RESULTS ===\n");
  for (const [slug, winners] of Object.entries(results)) {
    console.log(`${slug}:`);
    console.log(`  pastWinners: [`);
    for (const w of winners) {
      console.log(`    { year: ${w.year}, name: "${w.name}", team: "${w.team}" },`);
    }
    console.log(`  ],`);
  }
}

main().catch(console.error);
