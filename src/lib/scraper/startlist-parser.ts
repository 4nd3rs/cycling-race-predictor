/**
 * Startlist Parser
 *
 * Parses startlists from various cycling data sources:
 * - ProCyclingStats
 * - FirstCycling
 * - Official race websites (generic)
 */

import * as cheerio from "cheerio";
import { scrapeStartlist as pcsStartlist, type PCSStartlistEntry } from "./pcs";

export interface ParsedStartlistEntry {
  riderName: string;
  sourceId: string; // ID from the source (pcs_id, firstcycling_id, etc.)
  sourceType: "pcs" | "firstcycling" | "official" | "unknown";
  teamName: string | null;
  bibNumber: number | null;
  nationality: string | null;
}

export interface ParsedStartlist {
  entries: ParsedStartlistEntry[];
  raceName: string | null;
  raceDate: string | null;
  source: string;
  sourceUrl: string;
}

/**
 * Detect the source type from a URL
 */
export function detectSourceType(
  url: string
): "pcs" | "firstcycling" | "official" | "unknown" {
  if (url.includes("procyclingstats.com")) {
    return "pcs";
  }
  if (url.includes("firstcycling.com")) {
    return "firstcycling";
  }
  // Check for known official race sites
  if (
    url.includes("letour.fr") ||
    url.includes("giroditalia.it") ||
    url.includes("lavuelta.es") ||
    url.includes("flanders.be") ||
    url.includes("rondevanvlaanderen.be") ||
    url.includes("paris-roubaix.fr")
  ) {
    return "official";
  }
  return "unknown";
}

/**
 * Parse a startlist from ProCyclingStats
 */
async function parseProCyclingStats(url: string): Promise<ParsedStartlist> {
  const entries = await pcsStartlist(url);

  return {
    entries: entries.map((entry: PCSStartlistEntry) => ({
      riderName: entry.riderName,
      sourceId: entry.riderPcsId,
      sourceType: "pcs" as const,
      teamName: entry.teamName,
      bibNumber: entry.bibNumber,
      nationality: null,
    })),
    raceName: null, // Would need to scrape from page title
    raceDate: null,
    source: "ProCyclingStats",
    sourceUrl: url,
  };
}

/**
 * Parse a startlist from FirstCycling
 */
async function parseFirstCycling(url: string): Promise<ParsedStartlist> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "CyclingRacePredictor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const entries: ParsedStartlistEntry[] = [];

  // FirstCycling startlist format
  $("table tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");

    if (cells.length < 2) return;

    // Extract bib number (usually first cell)
    const bibText = cells.eq(0).text().trim();
    const bibNumber = parseInt(bibText, 10) || null;

    // Extract rider name and link
    const riderLink = $row.find("a[href*='r=']").first();
    const riderName = riderLink.text().trim();

    if (!riderName) return;

    // Extract FirstCycling rider ID from URL
    const riderHref = riderLink.attr("href") || "";
    const idMatch = riderHref.match(/r=(\d+)/);
    const sourceId = idMatch ? idMatch[1] : "";

    // Extract nationality from flag
    const flagImg = $row.find("img[src*='flag']").attr("src");
    const natMatch = flagImg?.match(/flag\/([A-Z]{3})/i);
    const nationality = natMatch ? natMatch[1].toUpperCase() : null;

    // Extract team
    const teamLink = $row.find("a[href*='t=']").first();
    const teamName = teamLink.text().trim() || null;

    entries.push({
      riderName,
      sourceId,
      sourceType: "firstcycling",
      teamName,
      bibNumber,
      nationality,
    });
  });

  // Extract race name from page title
  const raceName = $("h1").first().text().trim() || null;

  return {
    entries,
    raceName,
    raceDate: null,
    source: "FirstCycling",
    sourceUrl: url,
  };
}

/**
 * Generic parser for official race websites
 * This is a best-effort parser that looks for common patterns
 */
async function parseOfficialSite(url: string): Promise<ParsedStartlist> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "CyclingRacePredictor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const entries: ParsedStartlistEntry[] = [];

  // Look for tables with rider data
  $("table tr, .rider-list li, .startlist-item").each((_, el) => {
    const $el = $(el);
    const text = $el.text();

    // Try to extract rider name (usually prominent text)
    const links = $el.find("a");
    let riderName = "";

    links.each((_, link) => {
      const linkText = $(link).text().trim();
      // Rider names typically have at least 2 words
      if (linkText.split(" ").length >= 2 && !linkText.includes("Team")) {
        riderName = linkText;
        return false; // break
      }
    });

    if (!riderName) {
      // Try to find name from text content
      const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][A-Z]+)/);
      if (nameMatch) {
        riderName = nameMatch[1];
      }
    }

    if (!riderName) return;

    // Try to extract bib number
    const bibMatch = text.match(/^\s*(\d{1,3})\s/);
    const bibNumber = bibMatch ? parseInt(bibMatch[1], 10) : null;

    // Try to extract nationality (3-letter code)
    const natMatch = text.match(/\b([A-Z]{3})\b/);
    const nationality = natMatch ? natMatch[1] : null;

    entries.push({
      riderName,
      sourceId: "",
      sourceType: "official",
      teamName: null,
      bibNumber,
      nationality,
    });
  });

  return {
    entries,
    raceName: $("h1").first().text().trim() || null,
    raceDate: null,
    source: "Official Website",
    sourceUrl: url,
  };
}

/**
 * Main function to parse a startlist from any supported source
 */
export async function parseStartlist(url: string): Promise<ParsedStartlist> {
  const sourceType = detectSourceType(url);

  switch (sourceType) {
    case "pcs":
      return parseProCyclingStats(url);
    case "firstcycling":
      return parseFirstCycling(url);
    case "official":
      return parseOfficialSite(url);
    default:
      // Try generic parsing
      return parseOfficialSite(url);
  }
}

/**
 * Validate a startlist URL
 */
export function isValidStartlistUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize rider name for matching
 * Handles different name formats: "FIRST LAST", "Last, First", etc.
 */
export function normalizeRiderName(name: string): string {
  // Remove extra whitespace
  let normalized = name.trim().replace(/\s+/g, " ");

  // Handle "LAST, First" format
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  }

  // Convert to title case
  normalized = normalized
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return normalized;
}
