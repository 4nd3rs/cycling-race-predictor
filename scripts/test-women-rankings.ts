import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchAllUCIRankings } from "../src/lib/scraper/uci-rankings-api";

async function test() {
  console.log("Testing women elite rankings...\n");

  console.log("Fetching rankings from UCI DataRide API...");
  const rankings = await fetchAllUCIRankings("women_elite");

  console.log(`\nFound ${rankings.length} riders`);

  if (rankings.length > 0) {
    console.log("\nTop 10:");
    rankings.slice(0, 10).forEach((r, i) => {
      console.log(`${i + 1}. ${r.name} (${r.nationality}) - ${r.points} pts [UCI ID: ${r.uciId}]`);
    });
  }
}

test().catch(console.error);
