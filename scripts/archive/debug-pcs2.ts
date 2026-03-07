import { chromium } from "playwright";

async function scrapeRankings(url: string, gender: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector("table", { timeout: 10000 }).catch(() => {});

    const entries = await page.$$eval("table tbody tr", (rows) =>
      rows.slice(0, 10).map((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map(td => td.textContent?.trim() ?? "");
        const link = row.querySelector("a[href*='/rider/']");
        const pcsId = link?.getAttribute("href")?.split("/rider/")[1]?.split("/")[0] ?? "";
        const riderName = link?.textContent?.trim() ?? "";
        return { cells, pcsId, riderName };
      })
    );

    console.log(`${gender} rankings (first 10):`);
    entries.forEach(e => console.log("  cells:", JSON.stringify(e.cells), "pcsId:", e.pcsId, "name:", e.riderName));
  } finally {
    await browser.close();
  }
}

(async () => {
  await scrapeRankings("https://www.procyclingstats.com/rankings/me/uci-individual", "Men");
})().catch(console.error);
