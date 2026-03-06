/**
 * Try PCS for MTB XCO rankings + UCI riders page
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN!;
import { scrapeDo } from "../../src/lib/scraper/scrape-do";
import * as cheerio from "cheerio";

async function scrapeDoRender(url: string, wait = "5000"): Promise<string> {
  const params = new URLSearchParams({ token: SCRAPE_DO_TOKEN, url, render: "true", waitFor: wait });
  const res = await fetch("https://api.scrape.do?" + params, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`scrape.do ${res.status}`);
  return res.text();
}

async function main() {
  // 1. Try PCS MTB XCO junior rankings 
  console.log("=== PCS XCO Junior rankings ===");
  try {
    const pcsHtml = await scrapeDo("https://www.procyclingstats.com/rankings/xco/junior/2026");
    const $ = cheerio.load(pcsHtml);
    const rows: string[] = [];
    $("table tbody tr").slice(0, 10).each((_, row) => {
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      rows.push(cells.join(" | "));
    });
    console.log("PCS rows:", rows.slice(0, 5));
    const filippiIdx = pcsHtml.toLowerCase().indexOf("filippi");
    console.log("Filippi:", filippiIdx > 0 ? "FOUND" : "not found");
  } catch (e: any) {
    console.log("PCS error:", e.message);
  }

  // 2. Try PCS general rankings search
  console.log("\n=== PCS general search ===");
  try {
    const pcsHtml2 = await scrapeDo("https://www.procyclingstats.com/rankings/xco/elite/2026");
    const $ = cheerio.load(pcsHtml2);
    const rows: string[] = [];
    $("table tbody tr").slice(0, 5).each((_, row) => {
      const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
      rows.push(cells.join(" | "));
    });
    console.log("Elite rows:", rows);
  } catch (e: any) {
    console.log("PCS error:", e.message);
  }

  // 3. Try UCI riders page with render
  console.log("\n=== UCI riders search page ===");
  try {
    const ridersHtml = await scrapeDoRender(
      "https://www.uci.org/riders/MTB/2026?category=Junior&search=filippi",
      "10000"
    );
    console.log("Length:", ridersHtml.length);
    const filippiIdx = ridersHtml.toLowerCase().indexOf("filippi");
    console.log("Filippi:", filippiIdx > 0 ? "FOUND" : "not found");
    if (filippiIdx > 0) {
      console.log(ridersHtml.substring(Math.max(0, filippiIdx - 100), filippiIdx + 300));
    }
  } catch (e: any) {
    console.log("UCI riders error:", e.message);
  }
}

main().catch(console.error);
