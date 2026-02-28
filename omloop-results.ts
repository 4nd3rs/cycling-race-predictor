import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  for (const url of [
    "https://www.procyclingstats.com/race/omloop-het-nieuwsblad/2026/result",
    "https://www.procyclingstats.com/race/omloop-het-nieuwsblad-we/2026/result",
  ]) {
    console.log("\n---", url);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    
    // Check for results table
    const rows = await page.$$eval("table.results tbody tr", (rows) =>
      rows.slice(0, 5).map((r) => {
        const cells = Array.from(r.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
        return cells.join(" | ");
      })
    ).catch(() => []);
    
    if (rows.length > 0) {
      console.log("Results found:");
      rows.forEach((r) => console.log(" ", r));
    } else {
      console.log("No results yet");
      // Check page title
      const title = await page.title();
      console.log("Page title:", title);
    }
  }
  
  await browser.close();
}
main().catch(console.error);
