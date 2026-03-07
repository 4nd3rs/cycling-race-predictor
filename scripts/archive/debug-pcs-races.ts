import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });
  try {
    await page.goto("https://www.procyclingstats.com/races.php", { waitUntil: "networkidle", timeout: 30000 });
    const title = await page.title();
    console.log("Title:", title);
    const tables = await page.$$eval("table", ts => ts.map(t => ({ class: t.className, rows: t.querySelectorAll("tr").length })));
    console.log("Tables:", JSON.stringify(tables));
    const firstRows = await page.$$eval("table tr", rows => rows.slice(0,5).map(r => {
      const cells = Array.from(r.querySelectorAll("td,th")).map(c => c.textContent?.trim()?.substring(0,40));
      const link = r.querySelector("a[href*='/race/']")?.getAttribute("href");
      return { cells, link };
    }));
    console.log("First rows:", JSON.stringify(firstRows, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(console.error);
