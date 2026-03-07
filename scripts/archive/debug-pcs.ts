import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    await page.goto("https://www.procyclingstats.com/rankings/me/uci-individual", {
      waitUntil: "networkidle",
      timeout: 30000
    });

    const title = await page.title();
    const url = page.url();
    console.log("Title:", title);
    console.log("URL:", url);

    // Get all table selectors present
    const tables = await page.$$eval("table", tables =>
      tables.map(t => ({
        class: t.className,
        rows: t.querySelectorAll("tr").length,
        firstRow: t.querySelector("tr td, tr th")?.textContent?.trim().substring(0, 50)
      }))
    );
    console.log("Tables found:", JSON.stringify(tables, null, 2));

    // Sample first 3 rows of any table
    const rows = await page.$$eval("table tr", rows =>
      rows.slice(0, 5).map(r => r.textContent?.replace(/\s+/g, ' ').trim().substring(0, 100))
    );
    console.log("First 5 rows:", rows);

  } finally {
    await browser.close();
  }
}
main().catch(console.error);
