/**
 * Explore UCI API endpoints for MTB individual rankings
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN!;

async function scrapeDo(url: string, render = true): Promise<string> {
  const params = new URLSearchParams({ token: SCRAPE_DO_TOKEN, url, render: String(render) });
  const res = await fetch("https://api.scrape.do?" + params, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`scrape.do ${res.status}: ${url}`);
  return res.text();
}

async function uciApi(path: string, bearerToken: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`https://www.uci.org/api/${path}`, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, text: await res.text() };
}

async function extractBearerToken(): Promise<string> {
  console.log("Fetching UCI MTB page to extract bearer token...");
  const html = await scrapeDo("https://www.uci.org/mountain-bike/rankings", true);
  const match = html.match(/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  if (!match) throw new Error("Could not find bearer token in page");
  console.log("Bearer token extracted");
  return match[0];
}

// Also look at the UCI rankings page JS to find what parameters are used
async function inspectRankingsPage(bearerToken: string) {
  // The UCI API for ranking details — look for all possible param combos
  // From the /rankings/technical response we know momentId exists
  // Let's try with rankingId or momentId
  const paramSets = [
    "rankingId=1",
    "rankingId=1&take=10",
    "momentId=198410&take=10",
    "momentId=198410",
    "rankingTypeId=1&momentId=198410",
    "rankingTypeId=1&momentId=198410&take=10&skip=0",
    "rankingTypeId=1&momentId=198410&discipline=MTB",
    // Try with gender and category params
    "rankingTypeId=1&gender=M&ageCategory=Elite&discipline=MTB&season=2026",
    "rankingTypeId=1&gender=M&ageCategory=Elite&discipline=MTB&season=2026&take=10",
    // From uci-sniff.ts — RankingsDiscipline endpoint on dataride.uci.ch
    // The uci.org API might have similar structure
    "rankings/RankingsDiscipline?disciplineId=7&seasonId=2026&genderId=1&categoryId=1",
  ];

  for (const params of paramSets) {
    const endpoint = params.startsWith("rankings/") ? params : `rankings/details?${params}`;
    const result = await uciApi(endpoint, bearerToken);
    const isJson = result.text.startsWith("[") || result.text.startsWith("{");
    const preview = result.text.substring(0, 400);
    console.log(`\n[${result.status}] /api/${endpoint}`);
    if (result.status === 200 && isJson) {
      console.log("  ✅ JSON:", preview);
    } else if (result.status !== 404 && result.status !== 400) {
      console.log("  →", preview.replace(/\n/g, " ").substring(0, 150));
    } else if (result.status === 400) {
      // Show validation errors
      console.log("  400:", preview.substring(0, 200));
    }
  }
}

async function main() {
  const token = await extractBearerToken();
  await inspectRankingsPage(token);
}

main().catch(console.error);
