/**
 * XCOdata Race Results Scraper
 *
 * Scrapes historical race results from xcodata.com to populate Elo ratings.
 * Fetches race list and individual race results for all categories.
 */

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const RATE_LIMIT_MS = 2500; // 2.5 seconds between requests

let lastRequestTime = 0;

// Category codes mapping
const CATEGORY_CODES: Record<string, { ageCategory: string; gender: string }> = {
  XCO_ME: { ageCategory: "elite", gender: "men" },
  XCO_WE: { ageCategory: "elite", gender: "women" },
  XCO_MU: { ageCategory: "u23", gender: "men" },
  XCO_WU: { ageCategory: "u23", gender: "women" },
  XCO_MJ: { ageCategory: "junior", gender: "men" },
  XCO_WJ: { ageCategory: "junior", gender: "women" },
};

export interface XCOdataRace {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  country: string;
  location: string;
  raceClass: string; // WC, HC, C1, C2, etc.
  url: string;
}

export interface XCOdataResult {
  position: number;
  riderName: string;
  nationality: string;
  time: string | null;
  uciPoints: number;
  xcoRiderId: string;
  status: "finished" | "dns" | "dnf" | "lap";
}

export interface XCOdataCategoryResults {
  categoryCode: string;
  ageCategory: string;
  gender: string;
  results: XCOdataResult[];
}

export interface XCOdataRaceResults {
  race: XCOdataRace;
  categories: XCOdataCategoryResults[];
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
 * Parse date from XCOdata format (e.g., "24 Jan 2025" or "24-26 Jan 2025")
 */
function parseXCOdataDate(dateStr: string): string {
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };

  // Handle range format: "24-26 Jan 2025" -> take first date
  const cleaned = dateStr.replace(/\d+-/, "");
  const match = cleaned.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);

  if (match) {
    const day = match[1].padStart(2, "0");
    const month = months[match[2]] || "01";
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

/**
 * Scrape the races list for a given year
 */
export async function scrapeXCOdataRacesList(
  year: number = 2025,
  raceClasses: string[] = ["WC", "HC", "C1"], // Focus on top-tier races
  onlyWithResults: boolean = true // Only include races that have results
): Promise<XCOdataRace[]> {
  // Note: XCOdata's year filter doesn't work via URL - it requires JS
  // We filter by checking if the race has winners listed
  const url = `https://www.xcodata.com/races/?year=${year}&series=&country=`;

  console.log(`Fetching XCOdata races list...`);

  const markdown = await fetchWithFirecrawl(url);
  const races: XCOdataRace[] = [];

  // Parse the markdown table format
  // Each row contains: | Date | Race info with link | Winners | Class |
  const lines = markdown.split("\n");

  for (const line of lines) {
    // Skip non-table rows
    if (!line.startsWith("|") || line.includes("| --- |")) continue;

    // Extract race link from the line
    // Format: [Race Name](https://www.xcodata.com/race/8899/)
    const raceMatch = line.match(
      /\[([^\]]+)\]\(https:\/\/www\.xcodata\.com\/race\/(\d+)\/\)/
    );
    if (!raceMatch) continue;

    const raceName = raceMatch[1];
    const raceId = raceMatch[2];

    // Extract date from the line (format: "24 Jan 2025" or similar)
    const dateMatch = line.match(/(\d{1,2}(?:-\d{1,2})?\s+[A-Za-z]{3}\s+\d{4})/);
    if (!dateMatch) continue;

    const raceDate = parseXCOdataDate(dateMatch[1]);

    // Extract country from flag image
    const countryMatch = line.match(/flags\/\d+\/([A-Z]{2,3})\.png/);
    const country = countryMatch ? countryMatch[1] : "";

    // Extract race class from the last column (WC, HC, C1, etc.)
    // The class is typically at the end of the row
    const classMatch = line.match(/\|\s*(WCh|WC|HC|CS|C1|C2|C3|NC|CC|JO)\s*\|?\s*$/i);
    const raceClass = classMatch ? classMatch[1].toUpperCase() : "";

    // Filter by desired race classes
    const classToCheck = raceClass === "WCH" ? "WC" : raceClass;
    if (raceClasses.length > 0 && !raceClasses.includes(classToCheck) && !raceClasses.includes(raceClass)) {
      continue;
    }

    // Check if race has results (look for winner rider links in the same row)
    const hasResults = line.includes("/rider/") && line.includes("**Winner**");

    // Skip if we only want races with results and this one doesn't have any
    if (onlyWithResults && !hasResults) {
      continue;
    }

    // Only include XCO races
    if (raceName.includes("XCO") || (!raceName.includes("XCC") && !raceName.includes("XCM") && !raceName.includes("XCE"))) {
      races.push({
        id: raceId,
        name: raceName,
        date: raceDate,
        country,
        location: "",
        raceClass: raceClass || "C1",
        url: `https://www.xcodata.com/race/${raceId}/`,
      });
    }
  }

  console.log(`Found ${races.length} races with results`);
  return races;
}

/**
 * Scrape results for a single race
 */
export async function scrapeXCOdataRaceResults(
  raceId: string
): Promise<XCOdataRaceResults | null> {
  const url = `https://www.xcodata.com/race/${raceId}/`;

  console.log(`Fetching race results for ${raceId}...`);

  const markdown = await fetchWithFirecrawl(url);

  // Parse race info from the header
  const nameMatch = markdown.match(/^#\s+(?:!\[[^\]]*\]\([^)]*\)\s*)?(.+)/m);
  const dateMatch = markdown.match(/(\d{1,2}(?:-\d{1,2})?\s+[A-Za-z]{3}\s+\d{4})/);
  const countryMatch = markdown.match(/flags\/\d+\/([A-Z]{2,3})\.png/);
  const classMatch = markdown.match(/\b(WCh|WC|HC|CS|C1|C2|C3|NC|CC|JO)\b/i);

  if (!nameMatch) {
    console.log(`Could not parse race ${raceId}`);
    return null;
  }

  let raceName = nameMatch[1].trim();
  raceName = raceName.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();

  const race: XCOdataRace = {
    id: raceId,
    name: raceName,
    date: dateMatch ? parseXCOdataDate(dateMatch[1]) : "",
    country: countryMatch ? countryMatch[1] : "",
    location: "",
    raceClass: classMatch ? classMatch[1].toUpperCase() : "",
    url,
  };

  // Determine which categories exist and their order
  // Categories appear as "- Men Elite", "- Women Elite", etc. before the tables
  // We need to find them in order of appearance
  const categoryMarkers = [
    { text: "Men Elite", code: "XCO_ME" },
    { text: "Women Elite", code: "XCO_WE" },
    { text: "Men U23", code: "XCO_MU" },
    { text: "Women U23", code: "XCO_WU" },
    { text: "Men Junior", code: "XCO_MJ" },
    { text: "Women Junior", code: "XCO_WJ" },
  ];

  // Find all category markers with their positions
  const foundCategories: Array<{ code: string; pos: number }> = [];
  for (const { text, code } of categoryMarkers) {
    // Look for the pattern "-\nCATEGORY" or "- CATEGORY" in markdown
    const patterns = [
      new RegExp(`-\\s*\\n\\s*${text}\\s*\\n`, "i"),
      new RegExp(`-\\s*${text}\\s*\\n`, "i"),
      new RegExp(`\\n${text}\\s*\\n`, "i"),
    ];

    for (const pattern of patterns) {
      const match = markdown.match(pattern);
      if (match && match.index !== undefined) {
        foundCategories.push({ code, pos: match.index });
        break;
      }
    }
  }

  // Sort by position in document
  foundCategories.sort((a, b) => a.pos - b.pos);
  const categoryOrder = foundCategories.map((c) => c.code);

  // Parse all result tables - they appear in order after the category list
  const tables: XCOdataResult[][] = [];
  const lines = markdown.split("\n");
  let currentTable: XCOdataResult[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect results table header
    if (trimmed.includes("| Rank |") && trimmed.includes("| Rider |")) {
      // Start new table
      if (currentTable.length > 0) {
        tables.push([...currentTable]);
        currentTable = [];
      }
      inTable = true;
      continue;
    }

    // Skip separator lines
    if (trimmed.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    // "View full results" marks end of partial results, but we continue parsing
    if (trimmed === "View full results") {
      continue;
    }

    // Parse result rows
    if (inTable && trimmed.startsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 2) continue;

      // First cell: position/rank
      const posMatch = cells[0].match(/^(\d+)/);
      if (!posMatch) continue;
      const position = parseInt(posMatch[1], 10);

      // Second cell: rider info
      const riderCell = cells[1];

      // Extract nationality from flag
      const nationalityMatch = riderCell.match(/flags\/\d+\/([A-Z]{2,3})\.png/);
      const nationality = nationalityMatch ? nationalityMatch[1] : "";

      // Extract rider name and ID from link
      const riderMatch = riderCell.match(
        /\[([^\]]+)\]\((?:https:\/\/www\.xcodata\.com)?\/rider\/([^/)]+)/
      );

      let riderName: string;
      let xcoRiderId: string;

      if (riderMatch) {
        riderName = riderMatch[1].trim();
        xcoRiderId = riderMatch[2];
      } else {
        // Try plain name
        const plainNameMatch = riderCell.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/);
        if (!plainNameMatch) continue;
        riderName = plainNameMatch[1].trim();
        xcoRiderId = riderName.toLowerCase().replace(/\s+/g, "-");
      }

      // Third cell: Result (time and points)
      let time: string | null = null;
      let uciPoints = 0;

      if (cells.length >= 3) {
        const resultCell = cells[2];
        const timeMatch = resultCell.match(/(\d{1,2}:\d{2}:\d{2})/);
        if (timeMatch) {
          time = timeMatch[1];
        }
        const pointsMatch = resultCell.match(/(\d+)\s*Pts/i);
        if (pointsMatch) {
          uciPoints = parseInt(pointsMatch[1], 10);
        }
      }

      currentTable.push({
        position,
        riderName,
        nationality,
        time,
        uciPoints,
        xcoRiderId,
        status: "finished",
      });
    }
  }

  // Don't forget the last table
  if (currentTable.length > 0) {
    tables.push([...currentTable]);
  }

  // Match tables to categories in order
  const categories: XCOdataCategoryResults[] = [];
  for (let i = 0; i < Math.min(categoryOrder.length, tables.length); i++) {
    const code = categoryOrder[i];
    const mapping = CATEGORY_CODES[code];
    if (mapping && tables[i].length > 0) {
      categories.push({
        categoryCode: code,
        ageCategory: mapping.ageCategory,
        gender: mapping.gender,
        results: tables[i],
      });
    }
  }

  console.log(
    `  Parsed ${categories.length} categories with ${categories.reduce(
      (sum, c) => sum + c.results.length,
      0
    )} total results`
  );

  return { race, categories };
}

/**
 * Scrape all races and results for a year
 */
export async function scrapeAllRacesForYear(
  year: number = 2025,
  raceClasses: string[] = ["WC", "HC", "C1"],
  maxRaces: number = 50
): Promise<XCOdataRaceResults[]> {
  const races = await scrapeXCOdataRacesList(year, raceClasses);
  const allResults: XCOdataRaceResults[] = [];

  const racesToProcess = races.slice(0, maxRaces);
  console.log(`Processing ${racesToProcess.length} races...`);

  for (const race of racesToProcess) {
    try {
      const results = await scrapeXCOdataRaceResults(race.id);
      if (results && results.categories.length > 0) {
        allResults.push(results);
      }
    } catch (error) {
      console.error(`Error processing race ${race.id}:`, error);
    }
  }

  return allResults;
}
