/**
 * ProCyclingStats Scraper
 *
 * Scrapes rider data, race results, and startlists from procyclingstats.com
 * Uses rate limiting and caching to be respectful to the source.
 */

import * as cheerio from "cheerio";

const PCS_BASE_URL = "https://www.procyclingstats.com";
const RATE_LIMIT_MS = parseInt(process.env.PCS_RATE_LIMIT_MS || "1200", 10); // Default 1.2s between requests

// Simple in-memory rate limiter
let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<string> {
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
      "User-Agent":
        "CyclingRacePredictor/1.0 (Educational Project; +https://github.com/cycling-race-predictor)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch ${url}`);
  }

  return response.text();
}

// ============================================================================
// TYPES
// ============================================================================

export interface PCSRider {
  pcsId: string;
  name: string;
  nationality: string | null;
  birthDate: string | null;
  team: string | null;
  teamUrl: string | null;
  photoUrl: string | null;
  weight: number | null;
  height: number | null;
  specialty: string[];
  uciRanking: number | null;
  pcsRanking: number | null;
}

export interface PCSRaceResult {
  position: number | null;
  riderName: string;
  riderPcsId: string;
  teamName: string | null;
  time: string | null;
  timeGap: string | null;
  uciPoints: number | null;
  pcsPoints: number | null;
  dnf: boolean;
  dns: boolean;
}

export interface PCSRace {
  pcsUrl: string;
  name: string;
  date: string;
  country: string | null;
  category: string | null;
  profileType: string | null;
  distance: number | null;
  elevation: number | null;
  startlistUrl: string | null;
}

export interface PCSStartlistEntry {
  riderName: string;
  riderPcsId: string;
  teamName: string | null;
  bibNumber: number | null;
}

// ============================================================================
// RIDER SCRAPING
// ============================================================================

/**
 * Scrape rider profile from PCS
 */
export async function scrapeRider(pcsId: string): Promise<PCSRider | null> {
  try {
    const url = `${PCS_BASE_URL}/rider/${pcsId}`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    // Check if rider exists
    if ($(".page-title").text().includes("not found")) {
      return null;
    }

    // Extract name
    const name = $("h1").first().text().trim();
    if (!name) return null;

    // Extract nationality from flag image
    const flagImg = $(".rdr-info-cont .flag").attr("class");
    const nationality = flagImg?.match(/flag ([a-z]{2})/)?.[1]?.toUpperCase() || null;

    // Extract birth date
    const infoText = $(".rdr-info-cont").text();
    const birthMatch = infoText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    let birthDate: string | null = null;
    if (birthMatch) {
      const months: Record<string, string> = {
        january: "01", february: "02", march: "03", april: "04",
        may: "05", june: "06", july: "07", august: "08",
        september: "09", october: "10", november: "11", december: "12",
      };
      const monthNum = months[birthMatch[2].toLowerCase()];
      if (monthNum) {
        birthDate = `${birthMatch[3]}-${monthNum}-${birthMatch[1].padStart(2, "0")}`;
      }
    }

    // Extract team
    const teamLink = $(".rdr-info-cont a[href*='team/']").first();
    const team = teamLink.text().trim() || null;
    const teamUrl = teamLink.attr("href") || null;

    // Extract photo
    const photoUrl = $(".rdr-img-cont img").attr("src") || null;

    // Extract weight and height
    const weightMatch = infoText.match(/Weight:\s*(\d+)/);
    const heightMatch = infoText.match(/Height:\s*(\d+\.?\d*)/);
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : null;
    const height = heightMatch ? parseFloat(heightMatch[1]) : null;

    // Extract specialty from profile badges
    const specialty: string[] = [];
    $(".pps span").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (text.includes("gc")) specialty.push("gc");
      if (text.includes("climb")) specialty.push("climber");
      if (text.includes("sprint")) specialty.push("sprinter");
      if (text.includes("time trial") || text.includes("tt")) specialty.push("tt");
      if (text.includes("classic") || text.includes("one day")) specialty.push("classics");
    });

    // Extract rankings from the info table
    let uciRanking: number | null = null;
    let pcsRanking: number | null = null;

    $(".rdr-rankings li").each((_, el) => {
      const text = $(el).text();
      if (text.includes("UCI World")) {
        const rankMatch = text.match(/(\d+)/);
        if (rankMatch) uciRanking = parseInt(rankMatch[1], 10);
      }
      if (text.includes("PCS Ranking")) {
        const rankMatch = text.match(/(\d+)/);
        if (rankMatch) pcsRanking = parseInt(rankMatch[1], 10);
      }
    });

    return {
      pcsId,
      name,
      nationality,
      birthDate,
      team,
      teamUrl,
      photoUrl: photoUrl ? `${PCS_BASE_URL}${photoUrl}` : null,
      weight,
      height,
      specialty,
      uciRanking,
      pcsRanking,
    };
  } catch (error) {
    console.error(`Error scraping rider ${pcsId}:`, error);
    return null;
  }
}

// ============================================================================
// RACE RESULTS SCRAPING
// ============================================================================

/**
 * Scrape race results from PCS
 */
export async function scrapeRaceResults(
  raceUrl: string
): Promise<PCSRaceResult[]> {
  try {
    const url = raceUrl.startsWith("http") ? raceUrl : `${PCS_BASE_URL}${raceUrl}`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    const results: PCSRaceResult[] = [];

    // Find the results table
    $("table.results tbody tr").each((_, row) => {
      const $row = $(row);

      // Extract position
      const posText = $row.find("td").eq(0).text().trim();
      const position = posText === "DNF" || posText === "DNS" ? null : parseInt(posText, 10) || null;

      // Extract rider info
      const riderLink = $row.find("a[href*='rider/']").first();
      const riderName = riderLink.text().trim();
      const riderHref = riderLink.attr("href") || "";
      const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";

      if (!riderName || !riderPcsId) return;

      // Extract team
      const teamName = $row.find("a[href*='team/']").text().trim() || null;

      // Extract time
      const timeCell = $row.find("td.time, td:contains(':')").first();
      const timeText = timeCell.text().trim();
      const time = timeText && timeText.includes(":") ? timeText : null;

      // Extract time gap
      const gapText = $row.find("td").last().text().trim();
      const timeGap = gapText.startsWith("+") ? gapText : null;

      // Extract points
      let uciPoints: number | null = null;
      let pcsPoints: number | null = null;
      $row.find("td").each((_, cell) => {
        const text = $(cell).text().trim();
        if ($(cell).hasClass("pnt") || $(cell).attr("title")?.includes("UCI")) {
          const points = parseInt(text, 10);
          if (!isNaN(points)) uciPoints = points;
        }
        if ($(cell).attr("title")?.includes("PCS")) {
          const points = parseInt(text, 10);
          if (!isNaN(points)) pcsPoints = points;
        }
      });

      const dnf = posText === "DNF";
      const dns = posText === "DNS";

      results.push({
        position,
        riderName,
        riderPcsId,
        teamName,
        time,
        timeGap,
        uciPoints,
        pcsPoints,
        dnf,
        dns,
      });
    });

    return results;
  } catch (error) {
    console.error(`Error scraping race results from ${raceUrl}:`, error);
    return [];
  }
}

// ============================================================================
// STARTLIST SCRAPING
// ============================================================================

/**
 * Scrape race startlist from PCS
 */
export async function scrapeStartlist(
  startlistUrl: string
): Promise<PCSStartlistEntry[]> {
  try {
    const url = startlistUrl.startsWith("http")
      ? startlistUrl
      : `${PCS_BASE_URL}${startlistUrl}`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    const entries: PCSStartlistEntry[] = [];
    const seenRiders = new Set<string>();

    // PCS uses various structures for startlists - try multiple selectors
    // Method 1: Team-based startlist (most common for stage races)
    // Structure: .startlist_v4 > li (team container) > .ridersCont > ul > li (rider)
    $(".startlist_v4 > li").each((_, teamEl) => {
      const $team = $(teamEl);
      // Team link has class "team" inside .ridersCont
      let teamName = $team.find("a.team").first().text().trim();
      // Fallback to any team link
      if (!teamName) {
        teamName = $team.find("a[href*='team/']").first().text().trim();
      }

      // Find all riders within this team block
      $team.find(".ridersCont ul li a[href*='rider/']").each((_, riderEl) => {
        const $rider = $(riderEl);
        const riderName = $rider.text().trim();
        const riderHref = $rider.attr("href") || "";
        const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";

        if (!riderName || !riderPcsId || seenRiders.has(riderPcsId)) return;
        seenRiders.add(riderPcsId);

        // Get bib number from sibling span
        const bibSpan = $rider.parent().find(".bib");
        const bibNumber = parseInt(bibSpan.text().trim(), 10) || null;

        entries.push({
          riderName,
          riderPcsId,
          teamName: teamName || null,
          bibNumber,
        });
      });
    });

    // Method 2: Simple list structure
    if (entries.length === 0) {
      $("ul.startlist_v4 li, .startlist li, ul.list li").each((_, el) => {
        const $el = $(el);
        if ($el.hasClass("team")) return; // Skip team headers

        const riderLink = $el.find("a[href*='rider/']").first();
        const riderName = riderLink.text().trim();
        const riderHref = riderLink.attr("href") || "";
        const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";

        if (!riderName || !riderPcsId || seenRiders.has(riderPcsId)) return;
        seenRiders.add(riderPcsId);

        const teamName = $el.find("a[href*='team/']").text().trim() || null;
        const bibText = $el.find(".bib, .nr").text().trim();
        const bibNumber = parseInt(bibText, 10) || null;

        entries.push({ riderName, riderPcsId, teamName, bibNumber });
      });
    }

    // Method 3: Table-based startlist
    if (entries.length === 0) {
      $("table.basic tbody tr, table.startlist tbody tr").each((_, row) => {
        const $row = $(row);
        if ($row.find("th").length > 0) return; // Skip header rows

        const riderLink = $row.find("a[href*='rider/']").first();
        const riderName = riderLink.text().trim();
        const riderHref = riderLink.attr("href") || "";
        const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";

        if (!riderName || !riderPcsId || seenRiders.has(riderPcsId)) return;
        seenRiders.add(riderPcsId);

        const teamName = $row.find("a[href*='team/']").text().trim() || null;
        const bibText = $row.find("td").first().text().trim();
        const bibNumber = parseInt(bibText, 10) || null;

        entries.push({ riderName, riderPcsId, teamName, bibNumber });
      });
    }

    // Method 4: Fallback - find all rider links on the page
    if (entries.length === 0) {
      $("a[href*='rider/']").each((_, el) => {
        const $el = $(el);
        const riderName = $el.text().trim();
        const riderHref = $el.attr("href") || "";
        const riderPcsId = riderHref.split("rider/")[1]?.split("/")[0] || "";

        // Filter out likely non-startlist links
        if (!riderName || !riderPcsId || seenRiders.has(riderPcsId)) return;
        if (riderName.length < 3) return; // Skip abbreviations
        if (riderHref.includes("/results") || riderHref.includes("/history")) return;

        seenRiders.add(riderPcsId);
        entries.push({ riderName, riderPcsId, teamName: null, bibNumber: null });
      });
    }

    return entries;
  } catch (error) {
    console.error(`Error scraping startlist from ${startlistUrl}:`, error);
    return [];
  }
}

// ============================================================================
// RACE LIST SCRAPING
// ============================================================================

/**
 * Scrape upcoming races from PCS calendar
 */
export async function scrapeUpcomingRaces(
  year: number = new Date().getFullYear()
): Promise<PCSRace[]> {
  try {
    const url = `${PCS_BASE_URL}/races.php?year=${year}&circuit=1&class=1.UWT,2.UWT,1.Pro,2.Pro`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    const races: PCSRace[] = [];

    $("table.basic tbody tr").each((_, row) => {
      const $row = $(row);

      // Extract race link and name
      const raceLink = $row.find("a[href*='race/']").first();
      const raceName = raceLink.text().trim();
      const raceUrl = raceLink.attr("href") || "";

      if (!raceName || !raceUrl) return;

      // Extract date
      const dateText = $row.find("td").first().text().trim();
      const dateMatch = dateText.match(/(\d{2})\.(\d{2})/);
      const date = dateMatch
        ? `${year}-${dateMatch[2]}-${dateMatch[1]}`
        : `${year}-01-01`;

      // Extract country from flag
      const flagClass = $row.find(".flag").attr("class");
      const country = flagClass?.match(/flag ([a-z]{2})/)?.[1]?.toUpperCase() || null;

      // Extract category
      const category = $row.find("td").eq(2).text().trim() || null;

      races.push({
        pcsUrl: raceUrl,
        name: raceName,
        date,
        country,
        category,
        profileType: null,
        distance: null,
        elevation: null,
        startlistUrl: `${raceUrl}/startlist`,
      });
    });

    return races;
  } catch (error) {
    console.error(`Error scraping races for ${year}:`, error);
    return [];
  }
}

// ============================================================================
// RACE DETAILS SCRAPING
// ============================================================================

/**
 * Scrape detailed race info from PCS
 */
export async function scrapeRaceDetails(raceUrl: string): Promise<Partial<PCSRace> | null> {
  try {
    const url = raceUrl.startsWith("http") ? raceUrl : `${PCS_BASE_URL}${raceUrl}`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    // Extract profile type from icons/badges
    let profileType: string | null = null;
    const profileImg = $(".icon.profile").attr("src");
    if (profileImg?.includes("p1") || profileImg?.includes("flat")) {
      profileType = "flat";
    } else if (profileImg?.includes("p2") || profileImg?.includes("hilly")) {
      profileType = "hilly";
    } else if (profileImg?.includes("p3") || profileImg?.includes("mountains") || profileImg?.includes("mountain")) {
      profileType = "mountain";
    }

    // Also check profile text
    const profileText = $(".infolist").text().toLowerCase();
    if (profileText.includes("flat")) profileType = "flat";
    if (profileText.includes("hilly") || profileText.includes("hills")) profileType = "hilly";
    if (profileText.includes("mountain")) profileType = "mountain";
    if (profileText.includes("itt") || profileText.includes("time trial")) profileType = "tt";

    // Extract distance
    const distanceMatch = $(".infolist").text().match(/(\d+(?:\.\d+)?)\s*km/i);
    const distance = distanceMatch ? parseFloat(distanceMatch[1]) : null;

    // Extract elevation
    const elevationMatch = $(".infolist").text().match(/(\d+(?:,\d+)?)\s*m/i);
    const elevation = elevationMatch
      ? parseInt(elevationMatch[1].replace(",", ""), 10)
      : null;

    return {
      profileType,
      distance,
      elevation,
    };
  } catch (error) {
    console.error(`Error scraping race details from ${raceUrl}:`, error);
    return null;
  }
}

// ============================================================================
// RIDER SEARCH
// ============================================================================

/**
 * Search for riders by name on PCS
 */
export async function searchRiders(query: string): Promise<Array<{ name: string; pcsId: string }>> {
  try {
    const url = `${PCS_BASE_URL}/search.php?term=${encodeURIComponent(query)}&searchfor=R`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    const results: Array<{ name: string; pcsId: string }> = [];

    $("a[href*='rider/']").each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href") || "";
      const pcsId = href.split("rider/")[1]?.split("/")[0];

      if (name && pcsId) {
        results.push({ name, pcsId });
      }
    });

    return results.slice(0, 20); // Limit to 20 results
  } catch (error) {
    console.error(`Error searching riders for "${query}":`, error);
    return [];
  }
}

// ============================================================================
// FULL RACE PAGE SCRAPING
// ============================================================================

/**
 * Scrape full race info from any PCS race URL
 * Handles:
 * - Stage race overview: /race/tour-name/2024 (fetches startlist from /startlist)
 * - Individual stage: /race/tour-name/2024/stage-5
 * - One-day race: /race/race-name/2024
 */
export async function scrapeRacePage(raceUrl: string): Promise<{
  race: PCSRace;
  startlist: PCSStartlistEntry[];
  isStageRace: boolean;
  stages?: Array<{ name: string; url: string; date: string }>;
} | null> {
  try {
    // Normalize URL
    let url = raceUrl.startsWith("http") ? raceUrl : `${PCS_BASE_URL}${raceUrl}`;
    // Remove trailing slash
    url = url.replace(/\/$/, "");

    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    // Detect if this is a stage race overview page
    const hasStageList = $("ul.list.stage-select li, .stage-select a, a[href*='/stage-']").length > 0;
    const urlHasStage = /\/stage-\d+/.test(url) || /\/prologue/.test(url);
    const isStageRaceOverview = hasStageList && !urlHasStage;

    // Extract race name from h1 or title
    let name = $("h1").first().text().trim();
    if (!name) {
      name = $(".page-title h1, .main h1, title").first().text().trim();
    }

    // Extract UCI category from name if present (e.g., "(2.Pro)")
    // Do this before cleaning up name so we can capture the category
    let categoryFromName: string | null = null;
    const categoryInName = name.match(/\((\d\.\w+|2\.UWT|1\.UWT)\)/i);
    if (categoryInName) {
      categoryFromName = categoryInName[1];
    }

    // Clean up name - remove common PCS formatting
    // Remove patterns like "2026 »", year prefixes, and category suffixes
    name = name
      .replace(/^\d{4}\s*»?\s*/, "")           // Remove "2026 »" prefix
      .replace(/\s*\d{4}\s*$/, "")              // Remove year suffix
      .replace(/\s*\|.*$/, "")                   // Remove "| ..." suffix
      .replace(/\s*-\s*ProCyclingStats.*$/i, "") // Remove site name
      .replace(/\s*\(\d\.\w+\)\s*/gi, "")       // Remove "(2.Pro)" etc
      .replace(/\s*\(2\.UWT\)\s*/gi, "")        // Remove "(2.UWT)"
      .replace(/\s*\(1\.UWT\)\s*/gi, "")        // Remove "(1.UWT)"
      .replace(/^\d+(st|nd|rd|th)\s+/i, "")     // Remove ordinal prefixes like "6th "
      .trim();

    // For individual stages, append stage info to name
    if (urlHasStage) {
      const stageMatch = url.match(/\/(stage-\d+|prologue)/);
      if (stageMatch) {
        const stageNum = stageMatch[1].replace("stage-", "Stage ");
        const capitalizedStage = stageNum.charAt(0).toUpperCase() + stageNum.slice(1);
        name = `${name} - ${capitalizedStage}`;
      }
    }

    // Extract date - look in multiple places
    let date = "";
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12",
      jan: "01", feb: "02", mar: "03", apr: "04",
      jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };

    // Try infolist first
    const infolistText = $(".infolist").text();
    let dateMatch = infolistText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);

    // Try the race header/subtitle
    if (!dateMatch) {
      const headerText = $(".sub, .race-header, .main3 .mg10").text();
      dateMatch = headerText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    }

    // Try anywhere on page
    if (!dateMatch) {
      const pageText = $("body").text();
      dateMatch = pageText.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
    }

    if (dateMatch) {
      const monthNum = months[dateMatch[2].toLowerCase()];
      if (monthNum) {
        date = `${dateMatch[3]}-${monthNum}-${dateMatch[1].padStart(2, "0")}`;
      }
    }

    // Fallback: extract year from URL
    if (!date) {
      const yearMatch = url.match(/\/(\d{4})(?:\/|$)/);
      if (yearMatch) {
        date = `${yearMatch[1]}-01-01`;
      }
    }

    // Extract country from flag - look for a larger flag (w32 class) or flag near race title
    // Skip small flags in navigation by looking for flags with size indicators
    let country: string | null = null;

    // First try to find a large flag (these are usually the race country flags)
    const largeFlagClass = $(".flag.w32, .flag[class*='c24']").first().attr("class") || "";
    const largeFlagMatch = largeFlagClass.match(/flag\s+(?:w32\s+)?(?:c24\s+)?([a-z]{2})/i) ||
                           largeFlagClass.match(/flag\s+([a-z]{2})/i);
    if (largeFlagMatch) {
      country = largeFlagMatch[1].toUpperCase();
    }

    // Fallback: look for flag in the main content area (skip header/nav)
    if (!country) {
      $(".main, .page-content, .w100p").find(".flag").each((_, el) => {
        if (!country) {
          const flagClass = $(el).attr("class") || "";
          const match = flagClass.match(/flag\s+([a-z]{2})/i);
          if (match && match[1] !== "gb") { // Skip GB which is often in nav
            country = match[1].toUpperCase();
          }
        }
      });
    }

    // Extract UCI category - look for "Classification: X.XXX" pattern in page text
    const bodyText = $("body").text();
    let category: string | null = null;
    const classMatch = bodyText.match(/Classification:\s*(2\.UWT|1\.UWT|2\.Pro|1\.Pro|2\.1|1\.1|2\.2|1\.2)/i);
    if (classMatch) {
      category = classMatch[1];
    }
    // Use category from name as fallback
    if (!category && categoryFromName) {
      category = categoryFromName;
    }

    // Get full page text for data extraction (PCS doesn't use consistent class names)
    const pageText = $("body").text();

    // Extract profile type from the parcours icon class
    // PCS uses: p1=flat, p2=hilly (medium mountains), p3=hilly (hard), p4=mountain, p5=mountain (hard)
    let profileType: string | null = null;

    // Look for the icon.profile span which has classes like "icon profile p2"
    const profileSpan = $("span.icon.profile, .icon.profile");
    if (profileSpan.length > 0) {
      const profileClass = profileSpan.attr("class") || "";
      if (profileClass.includes("p1")) profileType = "flat";
      else if (profileClass.includes("p2")) profileType = "hilly";
      else if (profileClass.includes("p3")) profileType = "hilly";
      else if (profileClass.includes("p4")) profileType = "mountain";
      else if (profileClass.includes("p5")) profileType = "mountain";
    }

    // Fallback: check profile image src
    if (!profileType) {
      const profileIcon = $("img[src*='profile']").attr("src") || "";
      if (profileIcon.includes("p1") || profileIcon.includes("icon1")) profileType = "flat";
      else if (profileIcon.includes("p2") || profileIcon.includes("icon2")) profileType = "hilly";
      else if (profileIcon.includes("p3") || profileIcon.includes("icon3")) profileType = "hilly";
      else if (profileIcon.includes("p4") || profileIcon.includes("icon4")) profileType = "mountain";
      else if (profileIcon.includes("p5") || profileIcon.includes("icon5")) profileType = "mountain";
    }

    // Check for specific race types in the race category text
    const pageTextLower = pageText.toLowerCase();
    if (!profileType) {
      // Look for ITT/TTT in Race category field specifically
      const raceCatMatch = pageText.match(/Race category:\s*([^\n]+)/i);
      if (raceCatMatch) {
        const raceCat = raceCatMatch[1].toLowerCase();
        if (raceCat.includes("itt") || raceCat.includes("ttt") || raceCat.includes("time trial")) {
          profileType = "tt";
        }
      }
    }

    // Check for cobbles
    if (!profileType && (pageTextLower.includes("cobble") || pageTextLower.includes("pavé"))) {
      profileType = "cobbles";
    }

    // Extract distance - look for "Distance: X km" pattern
    const distanceMatch = pageText.match(/Distance:\s*(\d+(?:[.,]\d+)?)\s*km/i);
    const distance = distanceMatch ? parseFloat(distanceMatch[1].replace(",", ".")) : null;

    // Extract elevation - look for "Vertical meters: X" pattern
    const elevationMatch = pageText.match(/Vertical meters:\s*(\d+)/i);
    const elevation = elevationMatch ? parseInt(elevationMatch[1], 10) : null;

    // Build startlist URL - for stage races, startlist is on the main race page
    const baseRaceUrl = url.replace(/\/(result|gc|points|kom|youth|startlist|stage-\d+|prologue)\/?.*$/, "");
    const startlistUrl = `${baseRaceUrl}/startlist`;

    // Extract stages if this is a stage race overview
    const stages: Array<{ name: string; url: string; date: string }> = [];
    if (isStageRaceOverview) {
      $("ul.list.stage-select li a, .stage-select a, table.basic tr a[href*='/stage-']").each((_, el) => {
        const stageUrl = $(el).attr("href");
        const stageName = $(el).text().trim();
        if (stageUrl && stageName) {
          stages.push({
            name: stageName,
            url: stageUrl.startsWith("http") ? stageUrl : `${PCS_BASE_URL}${stageUrl}`,
            date: "", // Could parse from the row if needed
          });
        }
      });
    }

    const race: PCSRace = {
      pcsUrl: url,
      name: name || "Unknown Race",
      date,
      country,
      category,
      profileType,
      distance,
      elevation,
      startlistUrl,
    };

    // Fetch the startlist
    let startlist: PCSStartlistEntry[] = [];
    try {
      startlist = await scrapeStartlist(startlistUrl);
    } catch (e) {
      console.log("Could not fetch startlist, may not be available yet");
    }

    return {
      race,
      startlist,
      isStageRace: isStageRaceOverview || hasStageList,
      stages: stages.length > 0 ? stages : undefined,
    };
  } catch (error) {
    console.error(`Error scraping race page ${raceUrl}:`, error);
    return null;
  }
}

// ============================================================================
// HISTORICAL RESULTS
// ============================================================================

/**
 * Scrape a rider's historical results from a specific year
 */
export async function scrapeRiderResults(
  pcsId: string,
  year: number
): Promise<Array<{
  raceName: string;
  raceUrl: string;
  date: string;
  position: number | null;
  dnf: boolean;
}>> {
  try {
    const url = `${PCS_BASE_URL}/rider/${pcsId}/${year}`;
    const html = await rateLimitedFetch(url);
    const $ = cheerio.load(html);

    const results: Array<{
      raceName: string;
      raceUrl: string;
      date: string;
      position: number | null;
      dnf: boolean;
    }> = [];

    $("table.rdrResults tbody tr, table.basic tbody tr").each((_, row) => {
      const $row = $(row);

      // Skip header rows
      if ($row.hasClass("thead")) return;

      // Extract date
      const dateText = $row.find("td").first().text().trim();
      const dateMatch = dateText.match(/(\d{2})\.(\d{2})/);
      const date = dateMatch ? `${year}-${dateMatch[2]}-${dateMatch[1]}` : "";

      // Extract race info
      const raceLink = $row.find("a[href*='race/']").first();
      const raceName = raceLink.text().trim();
      const raceUrl = raceLink.attr("href") || "";

      if (!raceName) return;

      // Extract position
      const posText = $row.find("td").last().text().trim();
      const position = posText === "DNF" ? null : parseInt(posText, 10) || null;
      const dnf = posText === "DNF";

      results.push({
        raceName,
        raceUrl,
        date,
        position,
        dnf,
      });
    });

    return results;
  } catch (error) {
    console.error(`Error scraping results for ${pcsId} in ${year}:`, error);
    return [];
  }
}
