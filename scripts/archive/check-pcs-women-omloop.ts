import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  const url = "https://www.procyclingstats.com/race/omloop-het-nieuwsblad-elite-women/2026/startlist";
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const h1 = await page.$eval("h1", (el) => el.textContent?.trim()).catch(() => "—");
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  const statusCode = page.url();

  console.log("URL:", statusCode);
  console.log("Title:", title);
  console.log("H1:", h1);
  console.log("Body (500):", bodyText);

  // Check for any rider links
  const riderLinks = await page.$$eval("a[href*='/rider/']", ls => ls.slice(0, 5).map(a => a.textContent?.trim()));
  console.log("Rider links:", riderLinks);

  // Check for team divs
  const teamDivs = await page.$$eval("ul.startlist_v4 li, .startlist_v4 li", ls => ls.length);
  console.log("Startlist items:", teamDivs);

  // Try to find the race name any other way
  const metaDesc = await page.$eval("meta[name='description']", (el) => el.getAttribute("content")).catch(() => "—");
  console.log("Meta desc:", metaDesc?.substring(0, 100));

  await browser.close();
}
main().catch(console.error).finally(() => process.exit(0));
