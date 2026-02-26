import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  });

  await page.goto("https://www.procyclingstats.com/race/omloop-het-nieuwsblad-we/2026/startlist", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Get the HTML of the first team's ridersCont
  const firstTeamHtml = await page.evaluate(() => {
    const teamEl = document.querySelector(".startlist_v4 > li");
    if (!teamEl) return "no team";
    return teamEl.innerHTML.substring(0, 800);
  });
  console.log("First team HTML:\n", firstTeamHtml);

  // Count all links in ridersCont
  const riderContLinks = await page.evaluate(() => {
    const links = document.querySelectorAll(".ridersCont a");
    return Array.from(links).slice(0, 10).map(a => ({
      text: a.textContent?.trim(),
      href: a.getAttribute("href"),
    }));
  });
  console.log("\nLinks in ridersCont:", JSON.stringify(riderContLinks, null, 2));

  // Get text content of ridersCont li
  const riderItems = await page.evaluate(() => {
    const items = document.querySelectorAll(".ridersCont li");
    return Array.from(items).slice(0, 5).map(li => ({
      text: li.textContent?.trim().substring(0, 60),
      html: li.innerHTML.substring(0, 150),
    }));
  });
  console.log("\nridersCont li items:", JSON.stringify(riderItems, null, 2));

  await browser.close();
}
main().catch(console.error).finally(() => process.exit(0));
