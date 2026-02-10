/**
 * Test script for a specific race with results
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { scrapeXCOdataRaceResults } from "../src/lib/scraper/xcodata-races";

async function main() {
  console.log("Testing race 8899 (has results)...\n");

  const results = await scrapeXCOdataRaceResults("8899");

  if (!results) {
    console.log("Could not fetch race results");
    return;
  }

  console.log(`Race: ${results.race.name}`);
  console.log(`Date: ${results.race.date}`);
  console.log(`Country: ${results.race.country}`);
  console.log(`Class: ${results.race.raceClass}`);
  console.log(`Categories found: ${results.categories.length}\n`);

  for (const category of results.categories) {
    console.log(`\n--- ${category.ageCategory} ${category.gender} (${category.categoryCode}) ---`);
    console.log(`Results: ${category.results.length} riders`);

    // Show top 5
    category.results.slice(0, 5).forEach((r) => {
      console.log(
        `  ${r.position}. ${r.riderName} (${r.nationality}) - ${r.time || "N/A"} - ${r.uciPoints} pts`
      );
    });
  }

  console.log("\n✓ Test completed!");
}

main().catch(console.error);
