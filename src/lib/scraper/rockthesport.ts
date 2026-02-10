/**
 * Rockthesport Scraper
 *
 * Scrapes MTB race startlists from rockthesport.com (Shimano Supercup events)
 * Uses Firecrawl API for cleaner data extraction.
 * Handles multiple age/gender categories and pagination.
 */

import * as cheerio from "cheerio";

type CheerioAPI = ReturnType<typeof cheerio.load>;

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const RATE_LIMIT_MS = 1000; // 1 request per second

// Simple in-memory rate limiter
let lastRequestTime = 0;

async function rateLimitedFirecrawl(url: string): Promise<string> {
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
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      waitFor: 2000, // Wait for dynamic content to load
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.data?.markdown || "";
}

// ============================================================================
// TYPES
// ============================================================================

export interface RockthesportEntry {
  firstName: string;
  lastName: string;
  category: string; // "ÉLITE", "SUB23", "JUNIOR", etc.
  teamName: string | null;
  clubName: string | null;
  nationality: string | null; // 3-letter ISO code
  bibNumber: number | null;
}

export interface RockthesportEvent {
  name: string;
  date: string;
  country: string;
  categories: string[]; // All unique categories found
  entries: RockthesportEntry[];
}

export interface CategoryMapping {
  ageCategory: "elite" | "u23" | "junior";
  gender: "men" | "women";
}

// ============================================================================
// CATEGORY MAPPING
// ============================================================================

// Valid category names from Rockthesport
const VALID_CATEGORIES = [
  "ÉLITE", "ELITE", "ÉLIT",
  "FÉMINA ÉLITE", "FEMINA ELITE", "FEMENINA ÉLITE", "FEMENINA ELITE", "FEMALE ELITE", "FEMALE ÉLITE",
  "SUB23", "SUB-23", "U23",
  "FÉMINA SUB23", "FEMINA SUB23", "FEMENINA SUB23", "FEMALE SUB23",
  "JUNIOR",
  "FÉMINA JUNIOR", "FEMINA JUNIOR", "FEMENINA JUNIOR", "FEMALE JUNIOR",
  "CADETE", // Will be filtered out
  "MASTER 30", "MASTER 40", "MASTER 50", "MASTER 60", // Will be filtered out
];

/**
 * Check if a string looks like a valid category
 */
function isValidCategory(text: string): boolean {
  const normalized = text.toUpperCase().trim();

  // Check exact matches
  if (VALID_CATEGORIES.some(c => c === normalized)) {
    return true;
  }

  // Check partial matches for compound categories
  if (
    normalized === "ÉLITE" || normalized === "ELITE" || normalized === "ÉLIT" ||
    normalized.includes("FÉMINA") || normalized.includes("FEMINA") ||
    normalized.includes("FEMENINA") || normalized.includes("FEMALE") ||
    normalized === "SUB23" || normalized === "SUB-23" || normalized === "U23" ||
    normalized === "JUNIOR" ||
    normalized === "CADETE" ||
    normalized.startsWith("MASTER")
  ) {
    return true;
  }

  return false;
}

/**
 * Map raw Rockthesport category to standardized age/gender categories.
 * Returns null for unsupported categories (Cadet, Master, etc.)
 */
export function mapCategory(rawCategory: string): CategoryMapping | null {
  const cat = rawCategory.toUpperCase().trim();

  // Women categories
  if (cat.includes("FÉMINA") || cat.includes("FEMINA") || cat.includes("FEMENINA") || cat.includes("FEMALE") || cat.includes("WOMEN")) {
    if (cat.includes("ÉLITE") || cat.includes("ELITE") || cat.includes("ÉLIT")) {
      return { ageCategory: "elite", gender: "women" };
    }
    if (cat.includes("SUB23") || cat.includes("SUB-23") || cat.includes("U23")) {
      return { ageCategory: "u23", gender: "women" };
    }
    if (cat.includes("JUNIOR")) {
      return { ageCategory: "junior", gender: "women" };
    }
    // Female without specific age = elite
    return { ageCategory: "elite", gender: "women" };
  }

  // Men categories (no female prefix)
  if (cat === "ÉLITE" || cat === "ELITE" || cat === "ÉLIT") {
    return { ageCategory: "elite", gender: "men" };
  }
  if (cat === "SUB23" || cat === "SUB-23" || cat === "U23") {
    return { ageCategory: "u23", gender: "men" };
  }
  if (cat === "JUNIOR") {
    return { ageCategory: "junior", gender: "men" };
  }

  // Unsupported categories: Cadet, Master, Open, etc.
  return null;
}

/**
 * Get display name for a category mapping
 */
export function getCategoryDisplayName(mapping: CategoryMapping): string {
  const gender = mapping.gender === "men" ? "Men" : "Women";
  const age = mapping.ageCategory === "elite" ? "Elite" :
              mapping.ageCategory === "u23" ? "U23" : "Junior";
  return `${age} ${gender}`;
}

// ============================================================================
// URL DETECTION
// ============================================================================

/**
 * Check if a URL is a Rockthesport event URL
 */
export function detectRockthesportUrl(url: string): boolean {
  return url.includes("rockthesport.com");
}

/**
 * Normalize a Rockthesport URL to the participant list page
 * Handles both English (/participant-list) and Spanish (/listado-participantes) URLs
 */
function normalizeParticipantListUrl(url: string): string {
  // Remove any existing path suffixes
  let baseUrl = url.replace(/\/(participant-list|listado-participantes|consulta-inscritos|results|resultados|info|startlist).*$/i, "");
  // Remove trailing slash
  baseUrl = baseUrl.replace(/\/+$/, "");

  // Detect language from URL and use appropriate suffix
  const isSpanish = url.includes("/es/") || url.includes("/evento/");
  const suffix = isSpanish ? "/listado-participantes" : "/participant-list";

  return baseUrl + suffix;
}

// ============================================================================
// MARKDOWN PARSING
// ============================================================================

/**
 * Parse a markdown table into rows
 */
function parseMarkdownTable(markdown: string): string[][] {
  const lines = markdown.split("\n");
  const rows: string[][] = [];

  for (const line of lines) {
    // Skip empty lines and separator lines (|---|---|)
    if (!line.trim() || line.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    // Parse table row
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1) // Remove first and last empty elements
        .map(cell => cell.trim());

      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }

  return rows;
}

/**
 * Extract entries from markdown content
 */
function extractEntriesFromMarkdown(markdown: string): RockthesportEntry[] {
  const entries: RockthesportEntry[] = [];
  const rows = parseMarkdownTable(markdown);

  if (rows.length < 2) {
    return entries;
  }

  // First row is headers
  const headers = rows[0].map(h => h.toUpperCase());

  // Find column indices
  const firstNameIdx = headers.findIndex(h =>
    h.includes("FIRST") || h.includes("NOMBRE") || h === "NAME"
  );
  const lastNameIdx = headers.findIndex(h =>
    h.includes("SURNAME") || h.includes("APELLIDO") || h.includes("LAST")
  );
  const teamIdx = headers.findIndex(h =>
    h.includes("TEAM") || h.includes("EQUIPO")
  );
  const clubIdx = headers.findIndex(h =>
    h.includes("CLUB")
  );
  const nationalityIdx = headers.findIndex(h =>
    h.includes("NATION") || h.includes("PAÍS") || h.includes("COUNTRY") || h === "NAT"
  );
  const bibIdx = headers.findIndex(h =>
    h.includes("BIB") || h.includes("DORSAL") || h === "NO" || h === "Nº"
  );

  // Category columns are typically 2, 3, 4 (after name columns)
  // Headers show multiple "CATEGORY" columns
  const categoryIndices: number[] = [];
  headers.forEach((h, i) => {
    if (h.includes("CATEGORY") || h.includes("CATEGORÍA") || h.includes("CAT")) {
      categoryIndices.push(i);
    }
  });

  // If no category headers found, use columns 2, 3, 4
  if (categoryIndices.length === 0) {
    categoryIndices.push(2, 3, 4);
  }

  // Parse data rows
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];

    // Skip if not enough cells
    if (cells.length < Math.max(firstNameIdx, lastNameIdx, teamIdx) + 1) {
      continue;
    }

    const firstName = firstNameIdx >= 0 ? cells[firstNameIdx]?.trim() || "" : cells[0]?.trim() || "";
    const lastName = lastNameIdx >= 0 ? cells[lastNameIdx]?.trim() || "" : cells[1]?.trim() || "";

    // Skip if no name
    if (!firstName && !lastName) continue;

    // Find category from category columns
    let category = "";
    for (const idx of categoryIndices) {
      const cellText = cells[idx]?.trim().toUpperCase() || "";
      if (cellText && isValidCategory(cellText)) {
        category = cellText;
        break;
      }
    }

    // Skip rows without valid category
    if (!category) continue;

    const teamName = teamIdx >= 0 ? cells[teamIdx]?.trim() || null : null;
    const clubName = clubIdx >= 0 ? cells[clubIdx]?.trim() || null : null;
    const nationality = nationalityIdx >= 0 ? cells[nationalityIdx]?.trim() || null : null;
    const bibStr = bibIdx >= 0 ? cells[bibIdx]?.trim() : null;
    const bibNumber = bibStr ? parseInt(bibStr, 10) || null : null;

    entries.push({
      firstName,
      lastName,
      category,
      teamName: teamName && teamName !== "..." ? teamName : null,
      clubName: clubName && clubName !== "..." ? clubName : null,
      nationality: nationality && nationality !== "..." ? nationality : null,
      bibNumber,
    });
  }

  return entries;
}

/**
 * Extract event metadata from markdown
 */
function extractEventMetadata(markdown: string, url: string): { name: string; date: string; country: string } {
  // Try to find event name from headers
  let name = "Unknown Event";
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match) {
    name = h1Match[1].trim();
  } else {
    // Try extracting from URL
    const urlMatch = url.match(/\/event\/([^\/]+)/);
    if (urlMatch) {
      name = urlMatch[1]
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // Clean up name
  name = name.replace(/\s*[-–|]\s*Participant List.*$/i, "").trim();
  name = name.replace(/\s*[-–|]\s*Lista de participantes.*$/i, "").trim();

  // Extract date
  let date = "";
  const dateMatch = markdown.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dateMatch) {
    date = `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
  } else {
    // Extract year from URL or name
    const yearMatch = url.match(/(20\d{2})/) || name.match(/(20\d{2})/);
    if (yearMatch) {
      date = `${yearMatch[1]}-01-01`;
    }
  }

  // Country - default to ESP for Rockthesport
  const country = "ESP";

  return { name, date, country };
}

// ============================================================================
// SCRAPING WITH PAGINATION
// ============================================================================

/**
 * Get the base event URL (without /participant-list or other suffixes)
 */
function getBaseEventUrl(url: string): string {
  let baseUrl = url.replace(/\/(participant-list|listado-participantes|consulta-inscritos|results|resultados|info|startlist).*$/i, "");
  baseUrl = baseUrl.replace(/\/+$/, "");
  return baseUrl;
}

/**
 * Extract metadata from the main event page HTML
 */
function extractMetadataFromMainPage($: CheerioAPI, url: string): { name: string; date: string; country: string } {
  let name = "Unknown Event";
  let date = "";
  const country = "ESP";

  // Extract name from page title or h1
  const pageTitle = $("h1").first().text().trim() || $("title").text().trim();
  if (pageTitle) {
    name = pageTitle
      .replace(/\s*[-–|]\s*Rockthesport.*$/i, "")
      .replace(/\s*[-–|]\s*Home.*$/i, "")
      .replace(/\s*\|\s*$/, "") // Remove trailing pipe
      .trim();
  } else {
    // Fallback to URL
    const urlMatch = url.match(/\/event\/([^\/]+)/);
    if (urlMatch) {
      name = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // Look for date in "Basic details" section
  // The event date typically appears after a day name like "Saturday" or "sábado"
  // Format: "When: 9:00 AM on Saturday, February 7, 2026" or "sábado, 21 de febrero de 2026"
  const bodyText = $("body").text();

  // English month names and Spanish month names
  const monthNamesEn = "January|February|March|April|May|June|July|August|September|October|November|December";
  const monthNamesEs = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";
  const dayNamesEn = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
  const dayNamesEs = "lunes|martes|miércoles|jueves|viernes|sábado|domingo";

  // Try to find dates that appear after a day name (more likely to be event date, not registration date)
  // Pattern: "Saturday, February 21, 2026" or "sábado, 21 de febrero de 2026"
  const contextualDatePatternEn = new RegExp(`(?:${dayNamesEn}),?\\s+(${monthNamesEn})\\s+(\\d{1,2}),?\\s+(20\\d{2})`, "i");
  const contextualDatePatternEs = new RegExp(`(?:${dayNamesEs}),?\\s+(\\d{1,2})\\s+de\\s+(${monthNamesEs})\\s+de\\s+(20\\d{2})`, "i");

  let dateMatch = bodyText.match(contextualDatePatternEn);
  if (dateMatch) {
    const monthIndex = new Date(`${dateMatch[1]} 1, 2000`).getMonth() + 1;
    const day = dateMatch[2].padStart(2, "0");
    const year = dateMatch[3];
    date = `${year}-${String(monthIndex).padStart(2, "0")}-${day}`;
  } else {
    dateMatch = bodyText.match(contextualDatePatternEs);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const monthMap: Record<string, number> = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
      };
      const monthIndex = monthMap[dateMatch[2].toLowerCase()] || 1;
      const year = dateMatch[3];
      date = `${year}-${String(monthIndex).padStart(2, "0")}-${day}`;
    }
  }

  // Fallback patterns without day name context
  if (!date) {
    const datePattern1 = new RegExp(`(${monthNamesEn})\\s+(\\d{1,2}),?\\s+(20\\d{2})`, "i");
    dateMatch = bodyText.match(datePattern1);
    if (dateMatch) {
      const monthIndex = new Date(`${dateMatch[1]} 1, 2000`).getMonth() + 1;
      const day = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3];
      date = `${year}-${String(monthIndex).padStart(2, "0")}-${day}`;
    }
  }

  // Fallback: try DD/MM/YYYY pattern
  if (!date) {
    const numericDateMatch = bodyText.match(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/);
    if (numericDateMatch) {
      date = `${numericDateMatch[3]}-${numericDateMatch[2].padStart(2, "0")}-${numericDateMatch[1].padStart(2, "0")}`;
    }
  }

  // Last fallback: year from URL
  if (!date) {
    const yearMatch = url.match(/(20\d{2})/);
    if (yearMatch) {
      date = `${yearMatch[1]}-01-01`;
    }
  }

  return { name, date, country };
}

/**
 * Scrape a Rockthesport event's participant list
 * Fetches main page for metadata, then participant list for entries
 */
export async function scrapeRockthesportEvent(url: string): Promise<RockthesportEvent | null> {
  try {
    const baseEventUrl = getBaseEventUrl(url);
    const participantListUrl = normalizeParticipantListUrl(url);
    console.log(`Scraping Rockthesport event from: ${baseEventUrl}`);

    // First, fetch the main event page to get proper metadata (name, date)
    let metadata: { name: string; date: string; country: string };

    try {
      console.log("Fetching main event page for metadata...");
      const mainPageHtml = await customFetch(baseEventUrl);
      const $ = cheerio.load(mainPageHtml);
      metadata = extractMetadataFromMainPage($, baseEventUrl);
      console.log(`Extracted from main page - Name: ${metadata.name}, Date: ${metadata.date}`);
    } catch (mainPageError) {
      console.log("Failed to fetch main page, using URL-based metadata:", mainPageError);
      // Fallback to extracting metadata from URL
      const urlMatch = url.match(/\/event\/([^\/]+)/);
      const name = urlMatch
        ? urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Unknown Event";
      const yearMatch = url.match(/(20\d{2})/);
      metadata = {
        name,
        date: yearMatch ? `${yearMatch[1]}-01-01` : "",
        country: "ESP",
      };
    }

    console.log(`Event: ${metadata.name}, Date: ${metadata.date}`);

    // Use custom scraper to fetch ALL pages (Firecrawl doesn't handle ASP.NET pagination)
    console.log("Fetching all pages with custom scraper...");
    const rawEntries = await fetchAllPagesWithCustomScraper(participantListUrl);

    // Deduplicate entries by firstName + lastName + category
    const seen = new Set<string>();
    const allEntries = rawEntries.filter((entry) => {
      const key = `${entry.firstName}|${entry.lastName}|${entry.category}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    if (allEntries.length < rawEntries.length) {
      console.log(`Removed ${rawEntries.length - allEntries.length} duplicate entries`);
    }

    // Extract unique categories
    const categories = [...new Set(allEntries.map((e) => e.category))].filter(Boolean);
    console.log(`Total entries: ${allEntries.length}, Categories: ${categories.join(", ")}`);

    return {
      name: metadata.name,
      date: metadata.date,
      country: metadata.country,
      categories,
      entries: allEntries,
    };
  } catch (error) {
    console.error(`Error scraping Rockthesport event from ${url}:`, error);
    return null;
  }
}

// ============================================================================
// CUSTOM PAGINATION FALLBACK
// ============================================================================

/**
 * Fetch ALL pages using custom ASP.NET pagination handling
 * Starts from page 1 and continues until no more entries are found
 */
async function fetchAllPagesWithCustomScraper(baseUrl: string): Promise<RockthesportEntry[]> {
  const allEntries: RockthesportEntry[] = [];
  const MAX_PAGES = 30; // Safety limit

  try {
    // Fetch first page to get form fields and initial entries
    console.log("Fetching page 1...");
    const firstPageHtml = await customFetch(baseUrl);
    const $ = cheerio.load(firstPageHtml);

    // Extract entries from first page
    const firstPageEntries = extractEntriesFromHtml($);
    console.log(`Page 1: Found ${firstPageEntries.length} entries`);
    allEntries.push(...firstPageEntries);

    // Get total pages from the page if available
    let totalPages = 1;
    const paginationText = $("body").text();
    const totalMatch = paginationText.match(/\/\s*(\d+)\s*(?:páginas|pages)?/i);
    if (totalMatch) {
      totalPages = parseInt(totalMatch[1], 10);
      console.log(`Detected ${totalPages} total pages`);
    }

    // If only 1 page or can't determine, try fetching more until empty
    if (totalPages <= 1) {
      totalPages = MAX_PAGES; // Will stop when we get empty results
    }

    // Extract form fields for pagination
    const formFields = extractFormFields($);
    const formAction = $("form").attr("action") || baseUrl;
    const fullFormUrl = formAction.startsWith("http")
      ? formAction
      : new URL(formAction, baseUrl).href;

    // Fetch remaining pages
    for (let page = 2; page <= Math.min(totalPages, MAX_PAGES); page++) {
      console.log(`Fetching page ${page}/${totalPages}...`);

      try {
        const formData = new URLSearchParams();

        // Add all hidden fields
        for (const [key, value] of Object.entries(formFields)) {
          formData.append(key, value);
        }

        // Add pagination fields (ASP.NET naming convention: ctl00$section$field)
        formData.set("ctl00$cphCuerpo$inputPage", page.toString());
        formData.set("ctl00$cphCuerpo$inputPageSelXL", page.toString());
        formData.set("ctl00$cphCuerpo$inputPageSelXS", page.toString());
        formData.set("ctl00$cphCuerpo$btFinScroll", "");  // Submit button
        // Don't set __EVENTTARGET - we're using the submit button directly

        const pageHtml = await customFetch(fullFormUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        const $page: CheerioAPI = cheerio.load(pageHtml);
        const pageEntries = extractEntriesFromHtml($page);
        console.log(`Page ${page}: Found ${pageEntries.length} entries`);

        // Stop if we got no entries (end of data)
        if (pageEntries.length === 0) {
          console.log(`No more entries found, stopping pagination`);
          break;
        }

        allEntries.push(...pageEntries);

        // Update form fields for next page (ViewState changes)
        const newFields = extractFormFields($page);
        Object.assign(formFields, newFields);

        // Rate limit between pages
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
      } catch (pageError) {
        console.error(`Error fetching page ${page}:`, pageError);
        // Stop on error - don't continue with potentially stale ViewState
        break;
      }
    }
  } catch (error) {
    console.error("Error in custom pagination:", error);
  }

  return allEntries;
}

async function customFetch(url: string, options?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent":
        "CyclingRacePredictor/1.0 (Educational Project; +https://github.com/cycling-race-predictor)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch ${url}`);
  }

  return response.text();
}

function extractFormFields($: CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) {
      fields[name] = value;
    }
  });
  return fields;
}

function extractEntriesFromHtml($: CheerioAPI): RockthesportEntry[] {
  const entries: RockthesportEntry[] = [];

  $("table tr").each((_, row) => {
    const $row = $(row);
    if ($row.find("th").length > 0) return;

    const cells = $row.find("td");
    if (cells.length < 7) return;

    const firstName = cells.eq(0).text().trim();
    const lastName = cells.eq(1).text().trim();

    if (!firstName && !lastName) return;

    // Find category from columns 2, 3, 4
    let category = "";
    for (const idx of [2, 3, 4]) {
      const cellText = cells.eq(idx).text().trim().toUpperCase();
      if (cellText && isValidCategory(cellText)) {
        category = cellText;
        break;
      }
    }

    if (!category) return;

    const teamName = cells.eq(5).text().trim() || null;
    const clubName = cells.eq(6).text().trim() || null;

    entries.push({
      firstName,
      lastName,
      category,
      teamName: teamName && teamName !== "..." ? teamName : null,
      clubName: clubName && clubName !== "..." ? clubName : null,
      nationality: null,
      bibNumber: null,
    });
  });

  return entries;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Filter entries by supported categories and map to standardized format
 */
export function filterAndMapEntries(
  entries: RockthesportEntry[]
): Array<RockthesportEntry & { mappedCategory: CategoryMapping }> {
  return entries
    .map((entry) => {
      const mapped = mapCategory(entry.category);
      if (mapped) {
        return { ...entry, mappedCategory: mapped };
      }
      return null;
    })
    .filter((e): e is RockthesportEntry & { mappedCategory: CategoryMapping } => e !== null);
}

/**
 * Group entries by their mapped category
 */
export function groupEntriesByCategory(
  entries: RockthesportEntry[]
): Map<string, Array<RockthesportEntry & { mappedCategory: CategoryMapping }>> {
  const filtered = filterAndMapEntries(entries);
  const groups = new Map<string, Array<RockthesportEntry & { mappedCategory: CategoryMapping }>>();

  for (const entry of filtered) {
    const key = `${entry.mappedCategory.ageCategory}_${entry.mappedCategory.gender}`;
    const existing = groups.get(key) || [];
    existing.push(entry);
    groups.set(key, existing);
  }

  return groups;
}
