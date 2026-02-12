/**
 * SuperCup MTB Standings Scraper
 *
 * Scrapes standings from supercupmtb.com/en/results/.
 * Championship PDFs are text-based (Vola Timing software), parsed directly with pdf-parse.
 */

import * as cheerio from "cheerio";
// @ts-expect-error - pdf-parse v1.x doesn't have types
import pdfParse from "pdf-parse/lib/pdf-parse.js";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

export interface SuperCupStanding {
  rank: number;
  name: string;
  totalPoints: number;
}

/**
 * Map our internal ageCategory+gender to the link text labels on supercupmtb.com
 * and the PDF filename fragments used in championship PDFs.
 */
const SUPERCUP_LINK_MAPPING: Record<
  string,
  { linkTexts: string[]; fileFragments: string[] }
> = {
  junior_men: {
    linkTexts: ["JUNIOR"],
    fileFragments: ["-Junior."],
  },
  junior_women: {
    linkTexts: ["WOMEN JUNIOR"],
    fileFragments: ["-F.Junior."],
  },
  elite_men: {
    linkTexts: ["ELITE"],
    fileFragments: ["-Elite_.", "-Elite.p"],
  },
  elite_women: {
    linkTexts: ["WOMEN ELITE"],
    fileFragments: ["-F.Elite"],
  },
  u23_men: {
    linkTexts: ["SUB23"],
    fileFragments: ["-Sub23."],
  },
  u23_women: {
    linkTexts: ["WOMEN SUB23"],
    fileFragments: ["-F.Sub23."],
  },
};

/**
 * Scrape supercupmtb.com/en/results/ to find championship standings PDF URLs.
 * Returns all championship PDF links (those with "Campeonato" or "Clasificacion-Campeonato" in URL).
 */
async function findChampionshipPdfUrls(): Promise<
  Array<{ label: string; url: string }>
> {
  const pageUrl = "https://supercupmtb.com/en/results/";
  console.log(`[SuperCup] Fetching results page: ${pageUrl}`);

  const response = await fetch(pageUrl, {
    headers: {
      "User-Agent": "CyclingRacePredictor/1.0 (Educational Project)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch SuperCup results page: HTTP ${response.status}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const results: Array<{ label: string; url: string }> = [];

  $("a[href$='.pdf']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim().replace(/^·\s*/, "");
    if (!href) return;

    const fullUrl = href.startsWith("http")
      ? href
      : new URL(href, "https://supercupmtb.com").toString();

    // Only championship standings PDFs (not individual race results)
    if (/Campeonato/i.test(fullUrl)) {
      results.push({ label: text, url: fullUrl });
    }
  });

  console.log(`[SuperCup] Found ${results.length} championship PDF links`);
  return results;
}

/**
 * Find the correct championship PDF URL for a given age category and gender.
 */
function findPdfForCategory(
  pdfs: Array<{ label: string; url: string }>,
  ageCategory: string,
  gender: string
): string | null {
  const key = `${ageCategory}_${gender}`;
  const mapping = SUPERCUP_LINK_MAPPING[key];
  if (!mapping) return null;

  // Match by URL file fragments (most reliable)
  for (const fragment of mapping.fileFragments) {
    const match = pdfs.find((p) => p.url.includes(fragment));
    if (match) return match.url;
  }

  // Fallback: match by link text
  for (const linkText of mapping.linkTexts) {
    // Exact match first (to avoid "ELITE" matching "WOMEN ELITE")
    const exact = pdfs.find(
      (p) => p.label.toUpperCase() === linkText.toUpperCase()
    );
    if (exact) return exact.url;
  }

  return null;
}

/**
 * Detect the number of race columns from the header line.
 * Header: "CltApellidos y NombreCategoríaEquipoLa NucíaBanyolesPuntos"
 * We count known race location names between "Equipo" and "Puntos".
 */
function detectRaceCount(text: string): number {
  const headerMatch = text.match(/Equipo(.+?)Puntos/i);
  if (!headerMatch) return 1;
  const racesPart = headerMatch[1].trim();
  if (!racesPart) return 1;

  // Known SuperCup venue names
  const venues = [
    "La Nucía", "La Nucia", "Banyoles", "Sabiñánigo", "Sabinanigo",
    "Santa Susanna", "Naturland", "Sea Otter",
  ];
  let count = 0;
  for (const venue of venues) {
    if (racesPart.toLowerCase().includes(venue.toLowerCase())) count++;
  }
  return Math.max(1, count);
}

/**
 * Extract the total points from trailing digits.
 * The line ends with N race scores + 1 total, all concatenated:
 *   "300300" (1 race: score=300, total=300)
 *   "30026226262" (2 races: score1=300, score2=262, total=262+300=562... but totals vary)
 *
 * Since total >= any individual score, it has the most or equal digits.
 * With raceCount known, divide trailing digits into raceCount+1 equal parts,
 * take the last part.
 */
function extractTotalPoints(trailingDigits: string, raceCount: number): number {
  if (!trailingDigits || trailingDigits.length === 0) return 0;

  const totalParts = raceCount + 1; // race scores + total
  const digitLen = trailingDigits.length;

  // If digit count divides evenly, each part is the same width
  if (digitLen % totalParts === 0) {
    const partLen = digitLen / totalParts;
    return parseInt(trailingDigits.substring(digitLen - partLen)) || 0;
  }

  // Uneven: total likely has more digits (it's the sum). Take the wider last segment.
  // Try: last ceil(digitLen/totalParts) digits
  const partLen = Math.ceil(digitLen / totalParts);
  return parseInt(trailingDigits.substring(digitLen - partLen)) || 0;
}

/**
 * Parse standings from PDF text extracted by pdf-parse.
 * Format: {rank}{LASTNAME FIRSTNAME}{Category}{Team}{race1score}{race2score}...{totalPoints}
 *
 * Example line: "1PEREZ RUIZ IkerJuniorSCOTT ESPAÑA300300"
 * The trailing digits are race scores + total. With 1 race: score is duplicated (300300 = 300).
 */
function parseStandingsFromText(text: string): SuperCupStanding[] {
  const standings: SuperCupStanding[] = [];
  const raceCount = detectRaceCount(text);
  console.log(`[SuperCup] Detected ${raceCount} race column(s) in PDF`);

  // Pre-process: join continuation lines (lines that don't start with a rank number)
  // into the previous line, to handle wrapped team names + scores
  const rawLines = text.split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // If this line starts with a rank number + uppercase letter, it's a new entry
    if (/^\d{1,3}[A-ZÁÉÍÓÚÑÀÈÌÒÙÇ]/.test(trimmed)) {
      lines.push(trimmed);
    } else if (lines.length > 0) {
      // Continuation line — append to previous
      lines[lines.length - 1] += trimmed;
    }
  }

  for (const trimmed of lines) {
    if (!trimmed) continue;

    // Match: {rank 1-3 digits}{LASTNAME ALL CAPS}{FirstName}{Category}{Team}{scores}
    const rankMatch = trimmed.match(/^(\d{1,3})([A-ZÁÉÍÓÚÑÀÈÌÒÙÇÄËÏÖÜÂÊÎÔÛ])/);
    if (!rankMatch) continue;

    const rank = parseInt(rankMatch[1]);
    const rest = trimmed.substring(rankMatch[1].length);

    // Find name: uppercase part transitions to lowercase (first name)
    let splitPos = -1;
    for (let i = 1; i < rest.length; i++) {
      if (
        /[a-záéíóúñàèìòùç]/u.test(rest[i]) &&
        /[A-ZÁÉÍÓÚÑÀÈÌÒÙÇ]/u.test(rest[i - 1])
      ) {
        splitPos = i - 1;
        break;
      }
    }
    if (splitPos <= 0) continue;

    const lastName = rest.substring(0, splitPos).trim();

    // First name ends at category keyword (including F. prefix for women and Élite with accent)
    const afterLastName = rest.substring(splitPos);
    const catMatch = afterLastName.match(
      /^([A-Za-záéíóúñàèìòùçäëïöüâêîôûæøå.\s-]+?)(?:F\.)?(?:Junior|[EÉ]lite|Sub23|Cadet|Master)/i
    );
    if (!catMatch) continue;
    const firstName = catMatch[1].trim().replace(/F\.\s*$/, "").trim();

    if (!lastName || !firstName || rank < 1) continue;

    // The trailing digits of the FULL line are the scores.
    // But team names can contain numbers. The scores are always the VERY END of the line.
    // Strategy: from the end, the total points section is raceCount+1 numbers concatenated.
    // Each race score is 1-4 digits, total is 1-4 digits.
    // With 1 race: the last 2-8 digits are {score}{total} where score==total.
    //   "300300" -> split in half -> 300
    //   "9696" -> 96
    //   "66" -> 6
    // With 2 races: last digits are {s1}{s2}{total}

    // Get ALL trailing digits from the line
    const endDigitsMatch = trimmed.match(/(\d+)$/);
    if (!endDigitsMatch) continue;
    const endDigits = endDigitsMatch[1];

    let totalPoints = 0;
    if (raceCount === 1) {
      // With 1 race, score is duplicated: "300300" = 300, "9696" = 96, "66" = 6
      // Find the longest even-length suffix of endDigits where first half == second half.
      // This handles team names with numbers (e.g., "ECOTEK 024" → trailing "024210210")
      let found = false;
      for (let len = Math.min(8, endDigits.length); len >= 2; len -= 2) {
        if (len % 2 !== 0) continue;
        const suffix = endDigits.substring(endDigits.length - len);
        const firstHalf = suffix.substring(0, len / 2);
        const secondHalf = suffix.substring(len / 2);
        if (firstHalf === secondHalf && parseInt(firstHalf) > 0) {
          totalPoints = parseInt(firstHalf);
          found = true;
          break;
        }
      }
      if (!found) {
        // Fallback: last 1-3 digits
        totalPoints = parseInt(endDigits.substring(Math.max(0, endDigits.length - 3))) || 0;
      }
    } else {
      totalPoints = extractTotalPoints(endDigits, raceCount);
    }

    if (totalPoints < 1) continue;

    // Convert "PEREZ RUIZ" + "Iker" to "Iker Perez Ruiz"
    const fullName = `${firstName} ${lastName.split(" ").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}`;

    standings.push({ rank, name: fullName, totalPoints });
  }

  return standings;
}

/**
 * Scrape SuperCup standings for a specific age category and gender
 */
export async function scrapeSupercupStandings(
  ageCategory: string,
  gender: string
): Promise<SuperCupStanding[]> {
  const key = `${ageCategory}_${gender}`;
  if (!SUPERCUP_LINK_MAPPING[key]) {
    console.log(`[SuperCup] No category mapping for ${key}`);
    return [];
  }

  console.log(`[SuperCup] Scraping standings for ${ageCategory} ${gender}`);

  // Find championship PDF URLs
  const pdfs = await findChampionshipPdfUrls();
  if (pdfs.length === 0) {
    console.log("[SuperCup] No championship PDFs found");
    return [];
  }

  // Find the right PDF for this category
  const pdfUrl = findPdfForCategory(pdfs, ageCategory, gender);
  if (!pdfUrl) {
    console.log(
      `[SuperCup] No championship PDF found for ${key}. Available: ${pdfs.map((p) => p.label).join(", ")}`
    );
    return [];
  }

  console.log(`[SuperCup] Downloading PDF: ${pdfUrl}`);

  // Download and parse PDF
  const pdfResponse = await fetch(pdfUrl);
  if (!pdfResponse.ok) {
    throw new Error(`Failed to download PDF: HTTP ${pdfResponse.status}`);
  }

  const buffer = Buffer.from(await pdfResponse.arrayBuffer());
  const data = await pdfParse(buffer);

  if (!data.text || data.text.length < 50) {
    console.log("[SuperCup] PDF has no extractable text");
    return [];
  }

  console.log(
    `[SuperCup] Extracted ${data.text.length} chars from PDF`
  );

  // Parse standings from text
  const standings = parseStandingsFromText(data.text);
  console.log(
    `[SuperCup] Parsed ${standings.length} riders from standings`
  );

  if (standings.length > 0) {
    console.log(
      `[SuperCup] Top 3: ${standings.slice(0, 3).map((s) => `#${s.rank} ${s.name} (${s.totalPoints}pts)`).join(", ")}`
    );
  }

  return standings;
}

/**
 * Find a rider in SuperCup standings by name.
 * Handles name order differences (First Last vs Last First).
 */
export function findRiderInSupercupStandings(
  name: string,
  standings: SuperCupStanding[]
): SuperCupStanding | null {
  const normalized = normalizeName(name);

  // Exact match
  for (const standing of standings) {
    if (normalizeName(standing.name) === normalized) {
      return standing;
    }
  }

  // Reversed name parts
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
    for (const standing of standings) {
      if (normalizeName(standing.name) === reversed) {
        return standing;
      }
    }
  }

  // Partial match: last word of name + first 3 chars of first word
  if (parts.length >= 2) {
    for (const standing of standings) {
      const sParts = normalizeName(standing.name).split(/\s+/);
      if (sParts.length < 2) continue;

      // Try both name orderings
      const combos = [
        { first: parts[0], last: parts.slice(1).join(" ") },
        { first: parts[parts.length - 1], last: parts.slice(0, -1).join(" ") },
      ];

      for (const { first, last } of combos) {
        const sCombos = [
          { sFirst: sParts[0], sLast: sParts.slice(1).join(" ") },
          {
            sFirst: sParts[sParts.length - 1],
            sLast: sParts.slice(0, -1).join(" "),
          },
        ];

        for (const { sFirst, sLast } of sCombos) {
          if (
            last === sLast &&
            first.length >= 3 &&
            sFirst.length >= 3 &&
            (first.startsWith(sFirst.substring(0, 3)) ||
              sFirst.startsWith(first.substring(0, 3)))
          ) {
            return standing;
          }
        }
      }
    }
  }

  return null;
}
