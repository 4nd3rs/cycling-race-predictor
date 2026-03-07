/**
 * Scrape full results from Shimano Supercup Massi Banyoles 2026
 * Official results page: https://supercupmtb.com
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { chromium } from "playwright";

async function scrapePage(url: string, label: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    console.log(`\n=== ${label} ===`);
    console.log(`Loading: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    console.log("Title:", await page.title());

    // Get all tables
    const tables = await page.$$eval("table", ts =>
      ts.map(t => ({ class: t.className, rows: t.querySelectorAll("tr").length }))
    );
    console.log("Tables:", JSON.stringify(tables));

    // Get links with "result" in them
    const resultLinks = await page.$$eval("a[href]", links =>
      links
        .filter(a => /result|banyoles|2026/i.test(a.getAttribute("href") || "") || /result|banyoles|2026/i.test(a.textContent || ""))
        .map(a => ({ text: a.textContent?.trim().substring(0, 60), href: a.getAttribute("href") }))
        .slice(0, 20)
    );
    console.log("Relevant links:", JSON.stringify(resultLinks, null, 2));

    // Sample first table rows
    const rows = await page.$$eval("table tr", rows =>
      rows.slice(0, 10).map(r => ({
        cells: Array.from(r.querySelectorAll("td,th")).map(c => c.textContent?.trim().substring(0, 40)),
        link: r.querySelector("a")?.getAttribute("href"),
      }))
    );
    if (rows.length) console.log("Table rows:", JSON.stringify(rows, null, 2));

  } finally {
    await browser.close();
  }
}

async function main() {
  // Try official results pages
  await scrapePage("https://supercupmtb.com/en/results/", "Supercup Results Index");
  await scrapePage("https://supercupmtb.com/en/races/banyoles-super-cup-massi/", "Banyoles Race Page");
}

main().catch(console.error);
