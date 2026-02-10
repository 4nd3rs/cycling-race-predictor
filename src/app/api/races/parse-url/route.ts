import { NextRequest, NextResponse } from "next/server";
import { detectSource, SourceCapabilities } from "@/lib/scraper/source-detector";
import {
  scrapeRockthesportEvent,
  groupEntriesByCategory,
  getCategoryDisplayName,
} from "@/lib/scraper/rockthesport";

/**
 * Unified URL Parser API
 *
 * Detects the source from any URL and routes to the appropriate scraper.
 * Returns a normalized response that the UI can handle consistently.
 */

// Normalized category format
export interface ParsedCategory {
  key: string; // e.g., "elite_men", "u23_women"
  displayName: string;
  ageCategory: string;
  gender: string;
  riderCount?: number;
}

// Normalized entry (rider) format
export interface ParsedEntry {
  name: string;
  firstName?: string;
  lastName?: string;
  teamName?: string | null;
  clubName?: string | null;
  category?: string;
  pcsId?: string;
}

// Normalized PDF link format (for Copa Catalana-style sources)
export interface ParsedPdf {
  url: string;
  title: string;
  suggestedCategories: string[];
  year: string | null;
  raceName: string | null;
  raceDate: string | null;
}

// Normalized result format
export interface ParsedResult {
  position: number;
  name: string;
  category?: string;
  teamName?: string | null;
  time?: string;
  gap?: string | null;
  dnf?: boolean;
  dns?: boolean;
}

// Unified response format
export interface ParsedUrlResponse {
  source: SourceCapabilities;
  // Event/race info
  name?: string;
  date?: string;
  endDate?: string;
  country?: string;
  // Categories (for multi-category events)
  categories?: ParsedCategory[];
  // Startlist entries
  entries?: ParsedEntry[];
  totalEntries?: number;
  // Results
  results?: ParsedResult[];
  totalResults?: number;
  // PDF selection (for Copa Catalana-style)
  pdfs?: ParsedPdf[];
  // Additional info
  profileType?: string;
  distance?: number;
  elevation?: number;
  pcsUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    const source = detectSource(url);

    if (source.sourceType === "unknown") {
      return NextResponse.json(
        {
          error: "Unsupported URL",
          message: "We don't recognize this URL. Supported sources: ProCyclingStats, Rockthesport, Copa Catalana BTT",
        },
        { status: 400 }
      );
    }

    // Route to appropriate scraper based on source type
    let response: ParsedUrlResponse;

    switch (source.sourceType) {
      case "procyclingstats":
        response = await parseProcyclingStats(url, source);
        break;
      case "rockthesport":
        response = await parseRockthesport(url, source);
        break;
      case "copa_catalana":
        response = await parseCopaCatalana(url, source);
        break;
      case "cronomancha":
        response = await parseCronomancha(url, source);
        break;
      default:
        return NextResponse.json(
          { error: `Source ${source.sourceType} not yet implemented` },
          { status: 501 }
        );
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error parsing URL:", error);
    return NextResponse.json(
      { error: "Failed to parse URL" },
      { status: 500 }
    );
  }
}

/**
 * Parse ProCyclingStats URL
 */
async function parseProcyclingStats(
  url: string,
  source: SourceCapabilities
): Promise<ParsedUrlResponse> {
  // Call existing parse-startlist endpoint internally
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/races/parse-startlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error("Failed to parse ProCyclingStats URL");
  }

  const data = await response.json();

  return {
    source,
    name: data.name,
    date: data.date,
    country: data.country,
    profileType: data.profileType,
    distance: data.distance,
    elevation: data.elevation,
    pcsUrl: data.pcsUrl,
    entries: data.entries?.map((e: { riderName: string; teamName?: string; riderPcsId?: string }) => ({
      name: e.riderName,
      teamName: e.teamName || null,
      pcsId: e.riderPcsId,
    })),
    totalEntries: data.riderCount || 0,
  };
}

/**
 * Parse Rockthesport URL
 */
async function parseRockthesport(
  url: string,
  source: SourceCapabilities
): Promise<ParsedUrlResponse> {
  // Call scraper directly (avoid auth issues with internal HTTP calls)
  const event = await scrapeRockthesportEvent(url);

  if (!event) {
    throw new Error("Could not parse Rockthesport event. Please check the URL.");
  }

  // Group entries by supported categories
  const grouped = groupEntriesByCategory(event.entries);

  // Build category summary
  const categories: ParsedCategory[] = [];
  const categoryOrder = ["elite_men", "elite_women", "u23_men", "u23_women", "junior_men", "junior_women"];

  for (const [key, entries] of grouped) {
    const [ageCategory, gender] = key.split("_");
    const mapping = { ageCategory: ageCategory as "elite" | "u23" | "junior", gender: gender as "men" | "women" };
    categories.push({
      key,
      ageCategory,
      gender,
      displayName: getCategoryDisplayName(mapping),
      riderCount: entries.length,
    });
  }

  // Sort categories
  categories.sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key));

  // Calculate totals
  const supportedRiderCount = Array.from(grouped.values()).reduce((sum, entries) => sum + entries.length, 0);

  return {
    source,
    name: event.name,
    date: event.date,
    country: event.country,
    categories,
    entries: event.entries.map((e) => ({
      name: `${e.firstName} ${e.lastName}`,
      firstName: e.firstName,
      lastName: e.lastName,
      teamName: e.teamName || null,
      clubName: e.clubName || null,
      category: e.category,
    })),
    totalEntries: supportedRiderCount,
  };
}

/**
 * Parse Copa Catalana URL
 */
async function parseCopaCatalana(
  url: string,
  source: SourceCapabilities
): Promise<ParsedUrlResponse> {
  // Call existing parse-copa-catalana endpoint internally
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/races/parse-copa-catalana`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error("Failed to parse Copa Catalana URL");
  }

  const data = await response.json();

  return {
    source,
    name: data.eventName,
    country: source.defaultCountry,
    pdfs: data.pdfs?.map((p: { url: string; title: string; categories: string[]; year: string | null; raceName: string | null; raceDate: string | null }) => ({
      url: p.url,
      title: p.title,
      suggestedCategories: p.categories,
      year: p.year,
      raceName: p.raceName,
      raceDate: p.raceDate,
    })),
    // Copa Catalana supports these categories
    categories: [
      { key: "elite_men", displayName: "Elite Men", ageCategory: "elite", gender: "men" },
      { key: "u23_men", displayName: "U23 Men", ageCategory: "u23", gender: "men" },
      { key: "elite_women", displayName: "Elite Women", ageCategory: "elite", gender: "women" },
      { key: "u23_women", displayName: "U23 Women", ageCategory: "u23", gender: "women" },
      { key: "junior_men", displayName: "Junior Men", ageCategory: "junior", gender: "men" },
      { key: "junior_women", displayName: "Junior Women", ageCategory: "junior", gender: "women" },
    ],
  };
}

/**
 * Parse Cronomancha URL
 * Scrapes the page for event details, requires PDF upload for startlists
 */
async function parseCronomancha(
  url: string,
  source: SourceCapabilities
): Promise<ParsedUrlResponse> {
  let name: string | undefined;
  let date: string | undefined;

  // Try to extract from URL first as fallback
  const urlMatch = url.match(/\/evento\/([^/?]+)/);
  if (urlMatch) {
    name = urlMatch[1]
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/Hcuci/g, "HC/UCI")
      .replace(/Xco/g, "XCO")
      .replace(/Xcc/g, "XCC");
  }

  // Try to scrape the actual page for date
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CyclingPredictor/1.0)",
      },
    });

    if (response.ok) {
      const html = await response.text();

      // Extract event name from title or h1
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                         html.match(/<title>([^<|]+)/i);
      if (titleMatch) {
        name = titleMatch[1].trim();
      }

      // Extract date - look for "When:" or date patterns
      // Format: "Saturday, February 14, 2026" or "14/02/2026"
      const whenMatch = html.match(/When:.*?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i) ||
                        html.match(/When:.*?([A-Za-z]+),?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);

      if (whenMatch) {
        if (whenMatch.length === 4) {
          // DD/MM/YYYY format
          const [, day, month, year] = whenMatch;
          date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        } else if (whenMatch.length === 5) {
          // "Day, Month DD, YYYY" format
          const [, , monthName, day, year] = whenMatch;
          const months: Record<string, string> = {
            january: "01", february: "02", march: "03", april: "04",
            may: "05", june: "06", july: "07", august: "08",
            september: "09", october: "10", november: "11", december: "12",
          };
          const month = months[monthName.toLowerCase()];
          if (month) {
            date = `${year}-${month}-${day.padStart(2, "0")}`;
          }
        }
      }

      // Also try Spanish date format
      if (!date) {
        const spanishMatch = html.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
        if (spanishMatch) {
          const [, day, monthName, year] = spanishMatch;
          const months: Record<string, string> = {
            enero: "01", febrero: "02", marzo: "03", abril: "04",
            mayo: "05", junio: "06", julio: "07", agosto: "08",
            septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
          };
          const month = months[monthName.toLowerCase()];
          if (month) {
            date = `${year}-${month}-${day.padStart(2, "0")}`;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error scraping cronomancha:", error);
  }

  // Fallback date from URL year
  if (!date && urlMatch) {
    const yearMatch = urlMatch[1].match(/(20\d{2})/);
    if (yearMatch) {
      date = `${yearMatch[1]}-01-01`;
    }
  }

  return {
    source,
    name,
    date,
    country: source.defaultCountry,
    categories: [
      { key: "elite_men", displayName: "Elite Men", ageCategory: "elite", gender: "men" },
      { key: "elite_women", displayName: "Elite Women", ageCategory: "elite", gender: "women" },
      { key: "u23_men", displayName: "U23 Men", ageCategory: "u23", gender: "men" },
      { key: "u23_women", displayName: "U23 Women", ageCategory: "u23", gender: "women" },
      { key: "junior_men", displayName: "Junior Men", ageCategory: "junior", gender: "men" },
      { key: "junior_women", displayName: "Junior Women", ageCategory: "junior", gender: "women" },
    ],
    totalEntries: 0,
  };
}
