import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { parseRacePdfWithAI } from "../src/lib/scraper/ai-pdf-parser";

async function testAIParsing() {
  const url = "https://www.copacatalanabtt.com/wp-content/uploads/2026/02/Clasificacio-CCI-Sant-Fruitos-2026-Carrera-2.pdf";

  console.log("=== TESTING AI PDF PARSING ===\n");
  console.log(`URL: ${url}\n`);

  const result = await parseRacePdfWithAI(url);

  if (!result) {
    console.error("Failed to parse PDF");
    return;
  }

  console.log("\n=== PARSED DATA ===");
  console.log(`Event: ${result.eventName}`);
  console.log(`Date: ${result.date}`);
  console.log(`Location: ${result.location}`);
  console.log(`Categories: ${result.categories.join(", ")}`);
  console.log(`Total results: ${result.results.length}`);

  // Show results by category
  console.log("\n=== RESULTS BY CATEGORY ===");
  for (const cat of result.categories) {
    const catResults = result.results.filter(r => r.category === cat);
    console.log(`\n${cat} (${catResults.length} riders):`);
    for (const r of catResults.slice(0, 5)) {
      const pos = r.status === "finished" ? r.position : r.status.toUpperCase();
      console.log(`  ${pos}: ${r.name} | ${r.team || '-'} | ${r.time || '-'}`);
    }
    if (catResults.length > 5) {
      console.log(`  ... and ${catResults.length - 5} more`);
    }
  }
}

testAIParsing().catch(console.error);
