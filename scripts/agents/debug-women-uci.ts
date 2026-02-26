import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });
  await page.goto("https://www.procyclingstats.com/rankings/we/world-ranking", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check headers
  const headers = await page.$$eval("table thead th", ths => ths.map(th => th.textContent?.trim()));
  console.log("Headers:", headers);

  const rows = await page.$$eval("table tbody tr", trs =>
    trs.slice(0, 5).map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.textContent?.trim() ?? ""))
  );
  console.log("First 5 rows:");
  rows.forEach((r, i) => console.log(i + 1, JSON.stringify(r)));
}
main().catch(console.error).finally(() => process.exit(0));
