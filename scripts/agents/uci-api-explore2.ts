/**
 * Try rendering dataride with delay, and check UCI PDF/CSV download
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN!;

async function scrapeDo(url: string, render = true, extraParams?: Record<string, string>): Promise<string> {
  const params = new URLSearchParams({ token: SCRAPE_DO_TOKEN, url, render: String(render), ...extraParams });
  const res = await fetch("https://api.scrape.do?" + params, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`scrape.do ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  // Try rendering dataride iframe with extra wait time
  console.log("Rendering dataride iframe with 8s delay...");
  const html = await scrapeDo("https://dataride.uci.ch/iframe/rankings/7", true, {
    waitFor: "8000",  // wait 8 seconds for JS to load
    playWithPage: "() => page.waitForSelector('table tr')",
  });
  console.log("HTML length:", html.length);
  
  // Check if we have rider data
  for (const name of ["Schurter", "Nino", "Van der Poel", "Colombo", "Flückiger"]) {
    const idx = html.indexOf(name);
    if (idx > 0) {
      console.log(`\nFound "${name}":`);
      console.log(html.substring(Math.max(0, idx-50), idx+200));
      break;
    }
  }
  
  // Count table rows
  const rowMatches = html.match(/<tr/g);
  console.log("Table rows found:", rowMatches?.length ?? 0);
  
  // Check for error messages
  if (html.includes("Login") || html.includes("login")) {
    console.log("⚠️ Login page detected");
  }
  
  // Check for UCI PDF export
  console.log("\n--- Checking UCI PDF/Excel export ---");
  const pdfRes = await fetch("https://dataride.uci.ch/Results/ExportRankings?disciplineId=7&seasonId=2026&genderId=1&categoryId=1&rankingTypeId=1", {
    headers: { Accept: "*/*" },
    signal: AbortSignal.timeout(15000),
  });
  console.log("PDF export status:", pdfRes.status);
  console.log("Content-Type:", pdfRes.headers.get("content-type"));
}

main().catch(console.error);
