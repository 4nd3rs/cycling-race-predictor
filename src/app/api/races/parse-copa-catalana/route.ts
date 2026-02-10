import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

interface PdfLink {
  url: string;
  title: string;
  categories: string[];
  year: string | null;
  raceName: string | null;
  raceDate: string | null;
}

interface ParsedCopaCatalana {
  eventName: string;
  year: string;
  pdfs: PdfLink[];
}

// Known Copa Catalana race locations
const RACE_LOCATIONS: Record<string, string> = {
  "sant-fruitos": "Sant Fruitós de Bages",
  "santfruitos": "Sant Fruitós de Bages",
  "corco": "Corçó d'Amunt",
  "corrodamunt": "Corçó d'Amunt",
  "corro-damunt": "Corçó d'Amunt",
  "banyoles": "Banyoles",
  "vallromanes": "Vallromanes",
  "la-nucia": "La Nucía",
  "lanucia": "La Nucía",
  "girona": "Girona",
  "calella": "Calella",
  "terrassa": "Terrassa",
  "manresa": "Manresa",
  "vic": "Vic",
  "igualada": "Igualada",
  "sabadell": "Sabadell",
  "barcelona": "Barcelona",
  "bellver": "Bellver de Cerdanya",
  "alp": "Alp",
  "rasos-peguera": "Rasos de Peguera",
  "rasospeguera": "Rasos de Peguera",
};

/**
 * Extract year, race name, date, and categories from PDF URL
 */
function parsePdfUrl(url: string): { year: string | null; raceName: string | null; categories: string[]; date: string | null } {
  const lowerUrl = url.toLowerCase();

  // Extract year and month from URL path (e.g., /uploads/2024/05/)
  const dateMatch = url.match(/\/(\d{4})\/(\d{2})\//);
  const year = dateMatch ? dateMatch[1] : null;
  const month = dateMatch ? dateMatch[2] : null;

  // Construct approximate date (assume first of month if we only have year/month)
  // Copa Catalana races are typically on weekends, but we'll use day 15 as middle of month approximation
  let date: string | null = null;
  if (year && month) {
    date = `${year}-${month}-15`; // Approximate - middle of month
  } else if (year) {
    date = `${year}-01-01`;
  }

  // Extract race name from filename or path
  let raceName: string | null = null;
  const filename = url.split("/").pop()?.replace(".pdf", "") || "";
  const lowerFilename = filename.toLowerCase();

  // Try to match known locations
  for (const [key, name] of Object.entries(RACE_LOCATIONS)) {
    if (lowerUrl.includes(key) || lowerFilename.includes(key.replace("-", ""))) {
      raceName = name;
      break;
    }
  }

  // If no match, try to extract from filename
  if (!raceName) {
    // Remove category suffixes and clean up
    const cleanName = filename
      .replace(/-?(elite|sub23|junior|cadet|master|women|men|w\.elite|carrera-\d)/gi, "")
      .replace(/[-_]/g, " ")
      .replace(/\d+/g, "")
      .trim();
    if (cleanName.length > 2) {
      raceName = cleanName.split(" ").map(w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(" ");
    }
  }

  // Determine categories from filename
  const categories: string[] = [];

  if (lowerFilename.includes("elite") && !lowerFilename.includes("w.elite") && !lowerFilename.includes("women")) {
    categories.push("Elite Men");
  }
  if (lowerFilename.includes("sub23") && !lowerFilename.includes("w.sub23") && !lowerFilename.includes("women")) {
    categories.push("U23 Men");
  }
  if (lowerFilename.includes("junior") && !lowerFilename.includes("w.junior") && !lowerFilename.includes("women")) {
    categories.push("Junior Men");
  }
  if (lowerFilename.includes("w.elite") || (lowerFilename.includes("women") && lowerFilename.includes("elite"))) {
    categories.push("Elite Women");
  }
  if (lowerFilename.includes("w.sub23") || (lowerFilename.includes("women") && lowerFilename.includes("sub23"))) {
    categories.push("U23 Women");
  }
  if (lowerFilename.includes("w.junior") || (lowerFilename.includes("women") && lowerFilename.includes("junior"))) {
    categories.push("Junior Women");
  }
  if (lowerFilename.includes("cadet")) {
    categories.push("Cadet");
  }
  if (lowerFilename.includes("master")) {
    categories.push("Masters");
  }

  // If "carrera" pattern, map to categories
  if (lowerFilename.includes("carrera-1") || lowerFilename.includes("carrera1")) {
    if (categories.length === 0) categories.push("Elite Men", "U23 Men");
  }
  if (lowerFilename.includes("carrera-2") || lowerFilename.includes("carrera2")) {
    if (categories.length === 0) categories.push("Junior Men", "Junior Women", "Elite Women", "U23 Women");
  }

  return { year, raceName, categories, date };
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || !url.includes("copacatalanabtt.com")) {
      return NextResponse.json(
        { error: "Invalid Copa Catalana URL" },
        { status: 400 }
      );
    }

    // Fetch the classifications page
    const response = await fetch(url, {
      headers: {
        "User-Agent": "CyclingRacePredictor/1.0",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch page" },
        { status: 400 }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Find the most recent race section (2026)
    // Look for PDF links
    const pdfs: PdfLink[] = [];
    const seenUrls = new Set<string>();

    $("a[href*='.pdf']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || seenUrls.has(href)) return;
      seenUrls.add(href);

      // Parse URL for structured info
      const parsed = parsePdfUrl(href);

      // Build a nice title
      let title = "";
      if (parsed.year) {
        title += parsed.year;
      }
      if (parsed.raceName) {
        title += title ? ` - ${parsed.raceName}` : parsed.raceName;
      }
      if (parsed.categories.length > 0) {
        const catStr = parsed.categories.join(", ");
        title += title ? ` (${catStr})` : catStr;
      }
      if (!title) {
        title = href.split("/").pop()?.replace(".pdf", "") || "Results";
      }

      const fullUrl = href.startsWith("http") ? href : `https://www.copacatalanabtt.com${href}`;

      pdfs.push({
        url: fullUrl,
        title,
        categories: parsed.categories,
        year: parsed.year,
        raceName: parsed.raceName,
        raceDate: parsed.date,
      });
    });

    // Extract event name from page
    let eventName = "Copa Catalana";
    const h2Text = $("h2").first().text().trim();
    if (h2Text && h2Text.includes("SANT")) {
      eventName = h2Text;
    }

    // Extract year from most recent PDF
    const years = pdfs.map(p => p.year).filter(Boolean);
    const year = years.length > 0 ? Math.max(...years.map(y => parseInt(y!))).toString() : "2026";

    // Sort PDFs: most recent year first, then by race name
    const sortedPdfs = [...pdfs].sort((a, b) => {
      // First by year (descending)
      const yearA = a.year ? parseInt(a.year) : 0;
      const yearB = b.year ? parseInt(b.year) : 0;
      if (yearB !== yearA) return yearB - yearA;
      // Then by race name
      const nameA = a.raceName || "";
      const nameB = b.raceName || "";
      return nameA.localeCompare(nameB);
    });

    // Filter to only supported categories (Elite, U23, Junior - not Cadet/Masters)
    const supportedCategories = ["Elite Men", "Elite Women", "U23 Men", "U23 Women", "Junior Men", "Junior Women"];
    const supportedPdfs = sortedPdfs.filter(p =>
      p.categories.some(c => supportedCategories.includes(c))
    );

    return NextResponse.json({
      eventName,
      year,
      pdfs: supportedPdfs,
      allPdfs: sortedPdfs,
      totalPdfs: pdfs.length,
      yearRange: years.length > 0 ? {
        min: Math.min(...years.map(y => parseInt(y!))),
        max: Math.max(...years.map(y => parseInt(y!))),
      } : null,
    });
  } catch (error) {
    console.error("Error parsing Copa Catalana:", error);
    return NextResponse.json(
      { error: "Failed to parse Copa Catalana page" },
      { status: 500 }
    );
  }
}
