/**
 * Debug script to see raw XCOdata markdown
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";

async function fetchPage(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not set");
  }

  const response = await fetch(FIRECRAWL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      waitFor: 3000,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.markdown || "";
}

async function main() {
  const url = "https://www.xcodata.com/races/?year=2025&series=&country=";
  console.log(`Fetching: ${url}\n`);

  const markdown = await fetchPage(url);

  // Save to file for inspection
  const fs = await import("fs");
  fs.writeFileSync("/tmp/xcodata-races.md", markdown);
  console.log("Saved full markdown to /tmp/xcodata-races.md");

  // Show first 3000 chars
  console.log("\n=== First 3000 characters ===\n");
  console.log(markdown.substring(0, 3000));
}

main().catch(console.error);
