/**
 * UCI MTB World Cup Standings Scraper
 *
 * Scrapes World Cup standings from the UCI MTB World Series website.
 * World Cup points are accumulated from XCO/XCC races during the season.
 *
 * Note: The UCI World Series site only shows top riders on the main page.
 * For complete standings, we parse what's available.
 */

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const RATE_LIMIT_MS = 2500;

let lastRequestTime = 0;

// Category codes for World Cup standings
type WorldCupCategory = "ME" | "WE" | "MU23" | "WU23" | "MJ" | "WJ";

const CATEGORY_LABELS: Record<WorldCupCategory, string> = {
  ME: "Men Elite",
  WE: "Women Elite",
  MU23: "Men U23",
  WU23: "Women U23",
  MJ: "Men Junior",
  WJ: "Women Junior",
};

export interface WorldCupRider {
  rank: number;
  name: string;
  nationality: string; // 3-letter code
  team: string | null;
  points: number;
  athleteSlug: string | null; // From URL
}

/**
 * Fetch page using Firecrawl with rate limiting
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
      waitFor: 5000,
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
 * Parse World Cup standings table from markdown
 */
function parseWorldCupMarkdown(
  markdown: string,
  categoryLabel: string
): WorldCupRider[] {
  const riders: WorldCupRider[] = [];

  // Find the section for this category
  const sectionRegex = new RegExp(
    `UCI XCO World Cup ${categoryLabel} Overall Standings[\\s\\S]*?(?=UCI XCO World Cup|## Social|$)`,
    "i"
  );
  const sectionMatch = markdown.match(sectionRegex);

  if (!sectionMatch) {
    return [];
  }

  const section = sectionMatch[0];

  // Check if standings are available
  if (section.includes("No standings available")) {
    return [];
  }

  // Parse table rows
  const lines = section.split("\n");
  let inTable = false;

  for (const line of lines) {
    // Detect table start
    if (line.includes("| # |") || line.includes("| Rider")) {
      inTable = true;
      continue;
    }

    // Skip separator lines
    if (line.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    // Stop at end of table
    if (inTable && !line.startsWith("|")) {
      break;
    }

    // Parse data rows
    // Format: | 1 | [Christopher BLEVINS (USA)](url) TEAM NAME | 1996 |
    if (inTable && line.startsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 3) continue;

      // First cell is rank
      const rank = parseInt(cells[0], 10);
      if (isNaN(rank)) continue;

      // Second cell contains rider link, nationality, and team
      const riderCell = cells[1];

      // Extract name and nationality from link: [Name (NAT)](url)
      const nameMatch = riderCell.match(
        /\[([^\]]+)\s*\(([A-Z]{3})\)\]\(([^)]+)\)/
      );
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      const nationality = nameMatch[2];
      const athleteUrl = nameMatch[3];

      // Extract athlete slug from URL
      const slugMatch = athleteUrl.match(/\/athletes\/([^/]+)/);
      const athleteSlug = slugMatch ? slugMatch[1] : null;

      // Team is after the link
      const teamMatch = riderCell.match(/\]\([^)]+\)\s*(.+)$/);
      const team = teamMatch ? teamMatch[1].trim() : null;

      // Last cell is points
      const points = parseInt(cells[cells.length - 1].replace(/,/g, ""), 10) || 0;

      riders.push({
        rank,
        name,
        nationality,
        team,
        points,
        athleteSlug,
      });
    }
  }

  return riders;
}

/**
 * Map internal category to World Cup category code
 */
export function mapToWorldCupCategory(
  ageCategory: string,
  gender: string
): WorldCupCategory | null {
  const mapping: Record<string, WorldCupCategory> = {
    men_elite: "ME",
    women_elite: "WE",
    men_u23: "MU23",
    women_u23: "WU23",
    men_junior: "MJ",
    women_junior: "WJ",
  };

  const key = `${gender}_${ageCategory}`;
  return mapping[key] || null;
}

/**
 * Scrape World Cup standings for a category
 * @param ageCategory Age category (elite, u23, junior)
 * @param gender Gender (men, women)
 * @param season Season year (e.g., 2025)
 */
export async function scrapeWorldCupStandings(
  ageCategory: string,
  gender: string,
  season: number = 2025
): Promise<WorldCupRider[]> {
  const categoryCode = mapToWorldCupCategory(ageCategory, gender);
  if (!categoryCode) {
    console.log(`No World Cup category for ${ageCategory} ${gender}`);
    return [];
  }

  const categoryLabel = CATEGORY_LABELS[categoryCode];
  console.log(`Fetching World Cup ${categoryLabel} standings for ${season}...`);

  const url = `https://www.ucimtbworldseries.com/standings?series=xco&category=${categoryCode}&season=${season}`;

  try {
    const markdown = await fetchWithFirecrawl(url);
    const riders = parseWorldCupMarkdown(markdown, categoryLabel);

    if (riders.length === 0) {
      console.log(`No standings available for ${categoryLabel}`);
    } else {
      console.log(`Found ${riders.length} riders in World Cup standings`);
    }

    return riders;
  } catch (error) {
    console.error(`Error fetching World Cup standings:`, error);
    return [];
  }
}

/**
 * Scrape all available World Cup standings
 */
export async function scrapeAllWorldCupStandings(
  season: number = 2025
): Promise<Record<string, WorldCupRider[]>> {
  const results: Record<string, WorldCupRider[]> = {};

  const categories: Array<{ ageCategory: string; gender: string }> = [
    { ageCategory: "elite", gender: "men" },
    { ageCategory: "elite", gender: "women" },
    { ageCategory: "u23", gender: "men" },
    { ageCategory: "u23", gender: "women" },
    { ageCategory: "junior", gender: "men" },
    { ageCategory: "junior", gender: "women" },
  ];

  for (const { ageCategory, gender } of categories) {
    const key = `${gender}_${ageCategory}`;
    results[key] = await scrapeWorldCupStandings(ageCategory, gender, season);
  }

  return results;
}

/**
 * Find a rider in World Cup standings by name
 */
export function findRiderInWorldCupStandings(
  name: string,
  standings: WorldCupRider[]
): WorldCupRider | null {
  const normalized = normalizeName(name);

  // Try exact match first
  for (const rider of standings) {
    if (normalizeName(rider.name) === normalized) {
      return rider;
    }
  }

  // Try partial matching
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];

    for (const rider of standings) {
      const riderNorm = normalizeName(rider.name);
      if (riderNorm.includes(lastName)) {
        return rider;
      }
    }
  }

  return null;
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}
