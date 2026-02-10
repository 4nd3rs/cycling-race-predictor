/**
 * XCOdata Scraper
 *
 * Scrapes UCI MTB XCO rankings from xcodata.com using direct fetch + cheerio.
 * Provides complete rankings with all riders (not just top 40 like UCI DataRide).
 *
 * URL Pattern: https://www.xcodata.com/rankings/{CATEGORY}/{YEAR}/{DATE}/{PAGE}/?country=
 * Categories: ME (Men Elite), WE (Women Elite), MJ (Men Junior), WJ (Women Junior)
 */

import * as cheerio from "cheerio";

type CheerioAPI = ReturnType<typeof cheerio.load>;

const RATE_LIMIT_MS = 1000; // 1 second between requests to be respectful

let lastRequestTime = 0;

// Category codes for XCOdata URL
const CATEGORY_CODES: Record<string, string> = {
  men_elite: "ME",
  women_elite: "WE",
  men_junior: "MJ",
  women_junior: "WJ",
  men_u23: "ME", // U23 uses Elite rankings on XCOdata
  women_u23: "WE",
};

export type XCOdataCategory = "men_elite" | "women_elite" | "men_junior" | "women_junior";

export interface XCOdataRider {
  rank: number;
  name: string;
  nationality: string; // 2-letter code (from flag)
  uciPoints: number;
  teamName: string | null;
  xcoId: string; // From rider link URL
}

/**
 * Fetch page with rate limiting
 */
async function fetchWithRateLimit(url: string): Promise<string> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  const response = await fetch(url, {
    headers: {
      "User-Agent": "CyclingRacePredictor/1.0 (Educational Project)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch ${url}`);
  }

  return response.text();
}

/**
 * Parse XCOdata ranking table from HTML using cheerio
 */
function parseXCOdataHtml($: CheerioAPI): XCOdataRider[] {
  const riders: XCOdataRider[] = [];

  // Find the ranking table - it has class "table" and contains ranking data
  $("table.table tbody tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");

    if (cells.length < 4) return;

    // First cell: rank (may contain secondary rank number)
    const rankText = cells.eq(0).text().trim();
    const rankMatch = rankText.match(/^(\d+)/);
    if (!rankMatch) return;
    const rank = parseInt(rankMatch[1], 10);

    // Second cell: nationality flag + rider link
    const riderCell = cells.eq(1);

    // Extract nationality from flag image
    const flagImg = riderCell.find("img");
    let nationality = "";
    if (flagImg.length) {
      const flagSrc = flagImg.attr("src") || "";
      const natMatch = flagSrc.match(/flags\/\d+\/([A-Z]{2})\.png/);
      if (natMatch) {
        nationality = natMatch[1];
      }
    }

    // Extract rider name and XCO ID from link
    const riderLink = riderCell.find("a[href*='/rider/']");
    if (!riderLink.length) return;

    const name = riderLink.text().trim();
    const href = riderLink.attr("href") || "";
    const xcoIdMatch = href.match(/\/rider\/([^/]+)/);
    const xcoId = xcoIdMatch ? xcoIdMatch[1] : "";

    if (!name) return;

    // Third cell: team (may contain a link or be empty)
    let teamName: string | null = null;
    const teamCell = cells.eq(2);
    const teamLink = teamCell.find("a");
    if (teamLink.length) {
      teamName = teamLink.text().trim() || null;
    } else {
      teamName = teamCell.text().trim() || null;
    }

    // Fourth cell: UCI points
    const pointsText = cells.eq(3).text().trim().replace(/,/g, "");
    const uciPoints = parseInt(pointsText, 10) || 0;

    riders.push({
      rank,
      name,
      nationality,
      uciPoints,
      teamName,
      xcoId,
    });
  });

  return riders;
}

/**
 * Extract pagination info from page
 */
function getPaginationInfo($: CheerioAPI): { currentPage: number; totalPages: number } | null {
  // Look for "Page X/Y" text
  const pageText = $("body").text();
  const match = pageText.match(/Page\s+(\d+)\s*\/\s*(\d+)/i);
  if (match) {
    return {
      currentPage: parseInt(match[1], 10),
      totalPages: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Map our internal category to XCOdata category code
 */
export function mapToXCOdataCategory(
  ageCategory: string,
  gender: string
): string | null {
  const key = `${gender}_${ageCategory}`;
  if (key in CATEGORY_CODES) {
    return CATEGORY_CODES[key];
  }
  // U23 riders use Elite rankings
  if (ageCategory === "u23") {
    return gender === "men" ? "ME" : "WE";
  }
  return null;
}

/**
 * Get the latest ranking date from XCOdata
 */
async function getLatestRankingDate(categoryCode: string): Promise<string> {
  // Default to a recent known date
  const defaultDate = "2026-02-03";

  try {
    const url = `https://www.xcodata.com/rankings/${categoryCode}/2026/`;
    const html = await fetchWithRateLimit(url);
    const $ = cheerio.load(html);

    // Look for date selector options
    const dateOptions = $("select option, .dropdown-item, a[href*='/rankings/']");
    let latestDate = defaultDate;

    dateOptions.each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href") || $(el).attr("value") || "";

      // Look for YYYY-MM-DD pattern
      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/) || href.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const foundDate = dateMatch[1];
        if (foundDate > latestDate) {
          latestDate = foundDate;
        }
      }
    });

    return latestDate;
  } catch {
    return defaultDate;
  }
}

/**
 * Scrape complete XCOdata rankings for a category
 * @param ageCategory Age category (elite, u23, junior)
 * @param gender Gender (men, women)
 * @param maxPages Maximum pages to fetch (default: 50)
 * @param rankingDate Optional specific ranking date (YYYY-MM-DD), defaults to latest
 */
export async function scrapeXCOdataRankings(
  ageCategory: string,
  gender: string,
  maxPages: number = 50,
  rankingDate?: string
): Promise<XCOdataRider[]> {
  const categoryCode = mapToXCOdataCategory(ageCategory, gender);
  if (!categoryCode) {
    console.log(`No XCOdata category code for ${ageCategory} ${gender}`);
    return [];
  }

  // Get latest ranking date if not specified
  const date = rankingDate || await getLatestRankingDate(categoryCode);

  const allRiders: XCOdataRider[] = [];
  let currentPage = 1;
  let totalPages = 1;

  console.log(
    `Fetching XCOdata ${ageCategory} ${gender} rankings (${categoryCode}) for ${date}...`
  );

  while (currentPage <= Math.min(totalPages, maxPages)) {
    const url = `https://www.xcodata.com/rankings/${categoryCode}/2026/${date}/${currentPage}/?country=`;

    console.log(`  Fetching page ${currentPage}${totalPages > 1 ? `/${totalPages}` : ""}...`);

    try {
      const html = await fetchWithRateLimit(url);
      const $ = cheerio.load(html);
      const riders = parseXCOdataHtml($);

      if (riders.length === 0) {
        console.log(`  No riders found on page ${currentPage}, stopping`);
        break;
      }

      allRiders.push(...riders);
      console.log(
        `  Found ${riders.length} riders (total: ${allRiders.length})`
      );

      // Get pagination info on first page
      if (currentPage === 1) {
        const pagination = getPaginationInfo($);
        if (pagination) {
          totalPages = pagination.totalPages;
          console.log(`  Total pages: ${totalPages}`);
        }
      }

      currentPage++;
    } catch (error) {
      console.error(`Error fetching page ${currentPage}:`, error);
      break;
    }
  }

  console.log(`Fetched ${allRiders.length} total riders from XCOdata`);
  return allRiders;
}

/**
 * Find a rider in XCOdata rankings by name
 * Uses normalized matching with fuzzy fallback
 */
export function findRiderInXCOdataRankings(
  name: string,
  rankings: XCOdataRider[]
): XCOdataRider | null {
  const normalized = normalizeName(name);

  // Try exact match first
  for (const rider of rankings) {
    if (normalizeName(rider.name) === normalized) {
      return rider;
    }
  }

  // Try matching with name parts reversed (some sources use "Last, First" format)
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
    for (const rider of rankings) {
      if (normalizeName(rider.name) === reversed) {
        return rider;
      }
    }
  }

  // Try partial matching (last name + first initial)
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    for (const rider of rankings) {
      const riderNorm = normalizeName(rider.name);
      const riderParts = riderNorm.split(/\s+/);

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
  let bestMatch: XCOdataRider | null = null;
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
 * Removes accents, converts to lowercase, removes non-letters
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
 * Calculate name similarity score (0-1)
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
