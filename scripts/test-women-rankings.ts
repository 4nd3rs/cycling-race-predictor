import { config } from "dotenv";
config({ path: ".env.local" });

import { scrapeXCOdataRankings, mapToXCOdataCategory } from "../src/lib/scraper/xcodata";

async function test() {
  console.log("Testing women elite rankings...\n");

  // Check category mapping
  const code = mapToXCOdataCategory("elite", "women");
  console.log(`Category code for elite women: ${code}`);

  // Fetch rankings (just 2 pages for quick test)
  console.log("\nFetching rankings...");
  const rankings = await scrapeXCOdataRankings("elite", "women", 2);

  console.log(`\nFound ${rankings.length} riders`);

  if (rankings.length > 0) {
    console.log("\nTop 10:");
    rankings.slice(0, 10).forEach((r, i) => {
      console.log(`${i + 1}. ${r.name} (${r.nationality}) - ${r.uciPoints} pts`);
    });
  }
}

test().catch(console.error);
