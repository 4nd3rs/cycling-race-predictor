import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    // Try the results page with longer wait
    await page.goto("https://supercupmtb.com/en/results/", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Get all text content to see what's there
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("Body text (first 3000 chars):", bodyText.substring(0, 3000));

    // Get all links
    const links = await page.$$eval("a[href]", ls =>
      ls.map(a => ({ text: a.textContent?.trim().substring(0,50), href: a.getAttribute("href") }))
        .filter(l => l.href && l.href.length > 5)
    );
    console.log("\nAll links:", JSON.stringify(links.slice(0, 40), null, 2));

  } finally {
    await browser.close();
  }
}
main().catch(console.error);
