import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium } from "playwright";

async function getRankingLink(page: any, categoryName: string): Promise<string | null> {
  // Click the category dropdown (2nd k-dropdown = category)
  const dropdowns = await page.$$(".k-widget.k-dropdown");
  if (dropdowns.length < 2) return null;
  
  await dropdowns[1].click();
  await page.waitForTimeout(500);
  
  // Find option in list
  const option = await page.locator(`.k-animation-container li.k-item:has-text("${categoryName}")`).first();
  if (!await option.isVisible()) return null;
  await option.click();
  await page.waitForTimeout(2000);
  
  // Get XCO Individual Ranking link for this category
  const links = await page.$$eval("a[href*='RankingDetails'][href*='raceTypeId=92']", (as: HTMLAnchorElement[]) =>
    as.filter(a => new URL(a.href).searchParams.get("rankingTypeId") === "1")
       .map(a => a.href)
  );
  return links[0] ?? null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://dataride.uci.ch/iframe/rankings/7", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const categories = ["Men Elite", "Women Elite", "Men Junior", "Women Junior"];
  for (const cat of categories) {
    const url = await getRankingLink(page, cat);
    console.log(`${cat}: ${url}`);
  }

  await browser.close();
}
main().catch(console.error);
