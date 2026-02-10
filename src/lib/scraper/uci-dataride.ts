/**
 * UCI DataRide Scraper
 *
 * Scrapes official UCI MTB XCO rankings from dataride.uci.ch
 * This is the official UCI ranking source.
 */

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const RATE_LIMIT_MS = 2000; // 2 seconds between requests

let lastRequestTime = 0;

// UCI DataRide ranking configuration
// XCO = Cross-country Olympic (raceTypeId=92)
interface RankingConfig {
  rankingId: number;
  groupId: number;
  categoryId: number;
  raceTypeId: number;
  momentId: number;
  disciplineSeasonId: number;
}

// Current 2026 season configurations
const RANKING_CONFIGS: Record<string, RankingConfig> = {
  // Men Elite XCO
  men_elite: {
    rankingId: 148,
    groupId: 35,
    categoryId: 22, // Elite
    raceTypeId: 92, // XCO
    momentId: 197573,
    disciplineSeasonId: 453,
  },
  // Women Elite XCO (needs to be discovered)
  women_elite: {
    rankingId: 148,
    groupId: 35,
    categoryId: 23, // Women Elite
    raceTypeId: 92,
    momentId: 197573,
    disciplineSeasonId: 453,
  },
  // Men Junior XCO
  men_junior: {
    rankingId: 148,
    groupId: 35,
    categoryId: 25, // Junior Men
    raceTypeId: 92,
    momentId: 197573,
    disciplineSeasonId: 453,
  },
  // Women Junior XCO
  women_junior: {
    rankingId: 148,
    groupId: 35,
    categoryId: 26, // Junior Women
    raceTypeId: 92,
    momentId: 197573,
    disciplineSeasonId: 453,
  },
  // Men U23 - typically uses Elite rankings
  men_u23: {
    rankingId: 148,
    groupId: 35,
    categoryId: 24, // U23 Men
    raceTypeId: 92,
    momentId: 197573,
    disciplineSeasonId: 453,
  },
  // Women U23
  women_u23: {
    rankingId: 148,
    groupId: 35,
    categoryId: 27, // U23 Women (approximate)
    raceTypeId: 92,
    momentId: 197573,
    disciplineSeasonId: 453,
  },
};

export interface UCIRider {
  rank: number;
  name: string;
  nationality: string;
  team: string | null;
  age: number | null;
  points: number;
  uciId: string | null;
}

/**
 * Build UCI DataRide ranking URL
 */
function buildRankingUrl(config: RankingConfig): string {
  return `https://dataride.uci.ch/iframe/RankingDetails/${config.rankingId}?disciplineId=7&groupId=${config.groupId}&momentId=${config.momentId}&disciplineSeasonId=${config.disciplineSeasonId}&rankingTypeId=1&categoryId=${config.categoryId}&raceTypeId=${config.raceTypeId}`;
}

/**
 * Fetch page using Firecrawl
 */
async function fetchWithFirecrawl(url: string): Promise<string> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY environment variable is not set");
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
    const errorText = await response.text();
    throw new Error(`Firecrawl API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.data?.markdown || "";
}

/**
 * Parse UCI ranking markdown table
 */
function parseRankingMarkdown(markdown: string): UCIRider[] {
  const riders: UCIRider[] = [];

  // Find the table rows
  const lines = markdown.split("\n");
  let inTable = false;

  for (const line of lines) {
    // Detect table start
    if (line.includes("| Rank |") && line.includes("| Rider |")) {
      inTable = true;
      continue;
    }

    // Skip separator lines
    if (line.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    // Parse data rows
    if (inTable && line.startsWith("|")) {
      // Table format: | Rank | Movement | Moment | Status | [Name](link) | Nation | Team | Age | Points |
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 5) continue;

      // Find the rank (first numeric cell)
      let rank = 0;
      let riderIdx = -1;

      for (let i = 0; i < cells.length; i++) {
        const num = parseInt(cells[i], 10);
        if (!isNaN(num) && num > 0 && num < 10000) {
          if (rank === 0) {
            rank = num;
          }
        }
        // Find rider name (cell with markdown link)
        if (cells[i].includes("[") && cells[i].includes("](")) {
          riderIdx = i;
        }
      }

      if (rank === 0 || riderIdx === -1) continue;

      // Extract rider name and UCI ID from link
      const nameMatch = cells[riderIdx].match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!nameMatch) continue;

      let name = nameMatch[1].trim();
      const riderUrl = nameMatch[2];

      // Remove asterisk prefix (indicates U23 rider)
      name = name.replace(/^\\\*\s*/, "").replace(/^\*\s*/, "");

      // Extract UCI ID from URL
      const uciIdMatch = riderUrl.match(/RiderRankingDetails\/(\d+)/);
      const uciId = uciIdMatch ? uciIdMatch[1] : null;

      // Find nationality (3-letter code after rider name)
      let nationality = "";
      let team: string | null = null;
      let age: number | null = null;
      let points = 0;

      // Look for nation code (typically right after rider cell)
      for (let i = riderIdx + 1; i < cells.length; i++) {
        const cell = cells[i].trim();

        // 3-letter country code
        if (/^[A-Z]{3}$/.test(cell)) {
          nationality = cell;
          continue;
        }

        // Age (2-digit number)
        const ageNum = parseInt(cell, 10);
        if (!isNaN(ageNum) && ageNum >= 15 && ageNum <= 50) {
          age = ageNum;
          continue;
        }

        // Points (larger number at end)
        const ptsNum = parseInt(cell, 10);
        if (!isNaN(ptsNum) && ptsNum >= 1) {
          points = ptsNum;
          continue;
        }

        // Team name (longer text, not a code or number)
        if (cell.length > 3 && !cell.match(/^\d+$/) && !team) {
          team = cell;
        }
      }

      if (name && rank > 0) {
        riders.push({
          rank,
          name,
          nationality,
          team,
          age,
          points,
          uciId,
        });
      }
    }
  }

  return riders;
}

/**
 * Map internal category to UCI DataRide config key
 */
export function mapToUCICategory(
  ageCategory: string,
  gender: string
): string | null {
  const key = `${gender}_${ageCategory}`;
  if (key in RANKING_CONFIGS) {
    return key;
  }
  // U23 riders can use Elite rankings as fallback
  if (ageCategory === "u23") {
    return `${gender}_elite`;
  }
  return null;
}

/**
 * Scrape UCI XCO rankings for a category
 */
export async function scrapeUCIRankings(
  ageCategory: string,
  gender: string
): Promise<UCIRider[]> {
  const configKey = mapToUCICategory(ageCategory, gender);
  if (!configKey) {
    console.log(`No UCI ranking config for ${ageCategory} ${gender}`);
    return [];
  }

  const config = RANKING_CONFIGS[configKey];
  if (!config) {
    console.log(`Missing config for ${configKey}`);
    return [];
  }

  const url = buildRankingUrl(config);
  console.log(`Fetching UCI rankings from: ${url}`);

  try {
    const markdown = await fetchWithFirecrawl(url);
    const riders = parseRankingMarkdown(markdown);
    console.log(`Parsed ${riders.length} riders from UCI rankings`);
    return riders;
  } catch (error) {
    console.error(`Error fetching UCI rankings:`, error);
    return [];
  }
}

/**
 * Find best match for a rider name in UCI rankings
 */
export function findRiderInUCIRankings(
  name: string,
  rankings: UCIRider[]
): UCIRider | null {
  const normalized = normalizeName(name);

  // Try exact match first
  for (const rider of rankings) {
    if (normalizeName(rider.name) === normalized) {
      return rider;
    }
  }

  // Try partial matching (last name + first initial)
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    for (const rider of rankings) {
      const riderNorm = normalizeName(rider.name);
      const riderParts = riderNorm.split(/\s+/);

      // Check if last names match and first name starts the same
      if (riderParts.length >= 2) {
        const riderLast = riderParts[riderParts.length - 1];
        const riderFirst = riderParts[0];

        if (
          lastName === riderLast &&
          (firstName === riderFirst ||
            firstName.startsWith(riderFirst.substring(0, 3)) ||
            riderFirst.startsWith(firstName.substring(0, 3)))
        ) {
          return rider;
        }
      }
    }
  }

  // Try fuzzy matching
  let bestMatch: UCIRider | null = null;
  let bestScore = 0.6; // Minimum threshold

  for (const rider of rankings) {
    const score = calculateNameSimilarity(name, rider.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rider;
    }
  }

  return bestMatch;
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z\s]/g, "") // Remove non-letters
    .trim();
}

/**
 * Calculate name similarity (0-1)
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);

  if (n1 === n2) return 1;

  // Check containment
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;

  // Word overlap
  const words1 = new Set(n1.split(/\s+/).filter((w) => w.length > 2));
  const words2 = new Set(n2.split(/\s+/).filter((w) => w.length > 2));

  let matches = 0;
  for (const w of words1) {
    if (words2.has(w)) matches++;
  }

  const total = Math.max(words1.size, words2.size);
  return total > 0 ? matches / total : 0;
}
