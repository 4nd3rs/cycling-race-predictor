/**
 * Test script for XCOdata scraper
 *
 * Usage: npx tsx scripts/test-xcodata-scraper.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  scrapeXCOdataRacesList,
  scrapeXCOdataRaceResults,
} from "../src/lib/scraper/xcodata-races";

async function testScraper() {
  console.log("Testing XCOdata scraper...\n");

  // Check for API key
  if (!process.env.FIRECRAWL_API_KEY) {
    console.error("Error: FIRECRAWL_API_KEY not set in .env.local");
    process.exit(1);
  }

  try {
    // Test 1: Fetch races list
    console.log("=== Test 1: Fetching 2025 races list ===");
    const races = await scrapeXCOdataRacesList(2025, ["WC", "HC"]);
    console.log(`Found ${races.length} races\n`);

    if (races.length === 0) {
      console.log("No races found. Check if XCOdata page structure changed.");
      return;
    }

    // Show first 5 races
    console.log("First 5 races:");
    races.slice(0, 5).forEach((race, i) => {
      console.log(`  ${i + 1}. ${race.name} (${race.date}) - ${race.raceClass}`);
    });
    console.log("");

    // Test 2: Fetch a single race's results
    const testRace = races[0];
    console.log(`=== Test 2: Fetching results for "${testRace.name}" ===`);
    console.log(`Race ID: ${testRace.id}`);
    console.log(`URL: ${testRace.url}\n`);

    const results = await scrapeXCOdataRaceResults(testRace.id);

    if (!results) {
      console.log("Could not fetch race results");
      return;
    }

    console.log(`Race: ${results.race.name}`);
    console.log(`Date: ${results.race.date}`);
    console.log(`Country: ${results.race.country}`);
    console.log(`Categories found: ${results.categories.length}\n`);

    for (const category of results.categories) {
      console.log(`\n--- ${category.ageCategory} ${category.gender} ---`);
      console.log(`Results: ${category.results.length} riders`);

      // Show top 5
      category.results.slice(0, 5).forEach((r) => {
        console.log(
          `  ${r.position}. ${r.riderName} (${r.nationality}) - ${r.time || "N/A"} - ${r.uciPoints} pts`
        );
      });
    }

    console.log("\n✓ Scraper test completed successfully!");
  } catch (error) {
    console.error("Error:", error);
  }
}

testScraper();
