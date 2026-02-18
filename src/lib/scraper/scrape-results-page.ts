/**
 * Results Page URL Scraper
 *
 * Fetches an HTML page (e.g. Chelva downloads page) and discovers
 * result PDF links, mapping filenames to age categories and genders.
 */

import * as cheerio from "cheerio";

export interface DiscoveredResultPdf {
  ageCategory: string;
  gender: string;
  pdfUrl: string;
  filename: string;
}

/**
 * Category mapping from PDF filename fragments.
 * Keys are normalized (uppercase, hyphens removed) fragments to match against.
 */
const FILENAME_CATEGORY_MAP: Array<{
  patterns: string[];
  ageCategory: string;
  gender: string;
}> = [
  {
    patterns: ["ELITE-MEN", "ELITEMEN", "ELITE_MEN"],
    ageCategory: "elite",
    gender: "men",
  },
  {
    patterns: ["ELITE-WOMEN", "ELITEWOMEN", "ELITE_WOMEN"],
    ageCategory: "elite",
    gender: "women",
  },
  {
    patterns: ["U23-MEN", "U23MEN", "U23_MEN"],
    ageCategory: "u23",
    gender: "men",
  },
  {
    patterns: ["U23-WOMEN", "U23WOMEN", "U23_WOMEN"],
    ageCategory: "u23",
    gender: "women",
  },
  {
    patterns: [
      "JUNIOR-MEN",
      "JUNIORMEN",
      "JUNIOR_MEN",
      "JUNIOR-SERIES-MEN",
      "JUNIORSERIES-MEN",
      "JUNIOR-SERIESMEN",
    ],
    ageCategory: "junior",
    gender: "men",
  },
  {
    patterns: [
      "JUNIOR-WOMEN",
      "JUNIORWOMEN",
      "JUNIOR_WOMEN",
      "JUNIOR-SERIES-WOMEN",
      "JUNIORSERIES-WOMEN",
      "JUNIOR-SERIESWOMEN",
    ],
    ageCategory: "junior",
    gender: "women",
  },
];

/**
 * Map a PDF filename to ageCategory and gender.
 * Expects filenames like "RESULT-ELITE-MEN.pdf", "RESULT-U23-WOMEN.pdf", etc.
 */
function mapFilenameToCategory(
  filename: string
): { ageCategory: string; gender: string } | null {
  const upper = filename.toUpperCase();

  // Must contain "RESULT" to be a results PDF
  if (!upper.includes("RESULT")) return null;

  for (const mapping of FILENAME_CATEGORY_MAP) {
    for (const pattern of mapping.patterns) {
      if (upper.includes(pattern)) {
        return {
          ageCategory: mapping.ageCategory,
          gender: mapping.gender,
        };
      }
    }
  }

  return null;
}

/**
 * Scrape a page URL to discover result PDF links.
 * Returns an array of discovered PDFs with their categories.
 */
export async function scrapeResultsPageUrls(
  pageUrl: string
): Promise<DiscoveredResultPdf[]> {
  console.log(`[Results-Scraper] Fetching page: ${pageUrl}`);

  const response = await fetch(pageUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch results page: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const discovered: DiscoveredResultPdf[] = [];

  // Find all links to PDF files
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Only process PDF links
    if (!href.toLowerCase().endsWith(".pdf")) return;

    // Extract filename from URL
    const filename = href.split("/").pop() || href;

    // Map to category
    const category = mapFilenameToCategory(filename);
    if (!category) return;

    // Resolve relative URLs
    let pdfUrl: string;
    try {
      pdfUrl = new URL(href, pageUrl).toString();
    } catch {
      pdfUrl = href;
    }

    // Avoid duplicates
    if (discovered.some((d) => d.pdfUrl === pdfUrl)) return;

    discovered.push({
      ageCategory: category.ageCategory,
      gender: category.gender,
      pdfUrl,
      filename,
    });
  });

  console.log(
    `[Results-Scraper] Discovered ${discovered.length} result PDFs: ${discovered.map((d) => `${d.ageCategory}/${d.gender}`).join(", ")}`
  );

  return discovered;
}
