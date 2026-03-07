import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });
  try {
    await page.goto("https://www.xcodata.com/races", { waitUntil: "networkidle", timeout: 30000 });
    console.log("Title:", await page.title());
    const tables = await page.$$eval("table", ts => ts.map(t => ({ class: t.className, rows: t.querySelectorAll("tr").length })));
    console.log("Tables:", JSON.stringify(tables));
    const rows = await page.$$eval("table tr, .race-row, [class*='race']", rows =>
      rows.slice(0, 8).map(r => ({ text: r.textContent?.replace(/\s+/g,' ').trim().substring(0,120), link: r.querySelector('a')?.getAttribute('href') }))
    );
    console.log("Rows:", JSON.stringify(rows, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(console.error);
