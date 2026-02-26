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
    await page.goto("https://supercupmtb.com/en/results/", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get ALL links including hidden/dynamic
    const allLinks = await page.$$eval("a[href]", ls =>
      ls.map(a => ({ text: a.textContent?.replace(/\s+/g,' ').trim().substring(0,60), href: a.getAttribute("href") }))
        .filter(l => l.href && (l.href.includes('banyoles') || l.href.includes('result') || l.href.includes('clasificacion') || l.href.includes('pdf')))
    );
    console.log("Banyoles/result links:", JSON.stringify(allLinks, null, 2));

    // Try clicking on "RESULTS BANYOLES" text
    const banyolesLink = await page.$("a:has-text('Banyoles'), a:has-text('BANYOLES')");
    if (banyolesLink) {
      const href = await banyolesLink.getAttribute("href");
      console.log("Found Banyoles link:", href);
    }

    // Look for iframes or embedded results
    const iframes = await page.$$eval("iframe", fs => fs.map(f => f.getAttribute("src")));
    console.log("Iframes:", iframes);

    // Check for PDF links
    const pdfs = await page.$$eval("a[href*='.pdf'], a[href*='pdf']", ls =>
      ls.map(a => ({ text: a.textContent?.trim(), href: a.getAttribute("href") }))
    );
    console.log("PDF links:", JSON.stringify(pdfs, null, 2));

    // Now navigate to Banyoles race page directly
    await page.goto("https://supercupmtb.com/en/races/banyoles-super-cup-massi/", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const banyolesBody = await page.evaluate(() => document.body.innerText);
    console.log("\nBanyoles race page text:", banyolesBody.substring(0, 4000));

    const banyolesLinks = await page.$$eval("a[href]", ls =>
      ls.map(a => ({ text: a.textContent?.replace(/\s+/g,' ').trim().substring(0,60), href: a.getAttribute("href") }))
        .filter(l => l.href && (l.href.includes('result') || l.href.includes('pdf') || l.href.includes('clasif') || l.href.includes('vola') || l.href.includes('live') || l.href.includes('2026')))
    );
    console.log("\nBanyoles page relevant links:", JSON.stringify(banyolesLinks, null, 2));

  } finally {
    await browser.close();
  }
}
main().catch(console.error);
