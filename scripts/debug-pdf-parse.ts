/**
 * Debug PDF parsing to see what's being extracted
 */
import { parseCopaCatalanaPdfUrl } from "../src/lib/scraper/copa-catalana";

const PDF_URL = "https://www.copacatalanabtt.com/wp-content/uploads/2026/02/Clasificacio-CCI-Sant-Fruitos-2026-Carrera-2.pdf";

async function main() {
  console.log("Fetching and parsing PDF with updated parser...\n");

  const result = await parseCopaCatalanaPdfUrl(PDF_URL);

  if (!result) {
    console.error("Failed to parse PDF");
    return;
  }

  console.log("Event:", result.eventName);
  console.log("Date:", result.date);
  console.log("Categories found:", result.categories);
  console.log("\nResults count:", result.results.length);

  // Show Junior results specifically
  const juniorResults = result.results.filter(r => r.category === "Junior");
  console.log("\nJunior results:", juniorResults.length);

  // Show first 5 Junior results
  console.log("\nFirst 5 Junior results:");
  juniorResults.slice(0, 5).forEach(r => {
    console.log(`  #${r.position} ${r.name} - ${r.team} - ${r.time}`);
  });

  // Check if position 1 exists
  const pos1 = juniorResults.find(r => r.position === 1);
  if (pos1) {
    console.log("\n✓ Position 1 found:", pos1.name, "-", pos1.team);
  } else {
    console.log("\n⚠️ Position 1 NOT FOUND in Junior results!");
  }
}

main();
