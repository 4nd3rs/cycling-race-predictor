/**
 * UCI Results PDF Parser
 *
 * Parses UCI-style race result PDFs (Chelva format).
 * Each rider spans 3 lines in the extracted text:
 *   Line 1: "{pos}{bib}" or just "{bib}" (digits only)
 *   Line 2: "{LASTNAME}{FirstName}{NAT}  {Team}"
 *   Line 3: "{H:MM:SS}{laps}" or "-{N} LAP" or "DNF" or "DNS"
 * One PDF per category.
 */

// @ts-expect-error - pdf-parse v1.x doesn't have types
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface UciResultEntry {
  position: number;
  bibNumber: number;
  lastName: string;
  firstName: string;
  nationality: string;
  team: string;
  timeSeconds: number | null;
  laps: number | null;
  dnf: boolean;
  dns: boolean;
}

export interface ParsedUciResults {
  ageCategory: string;
  gender: string;
  results: UciResultEntry[];
}

/**
 * Detect category and gender from PDF header text.
 * Examples:
 *   "INDIVIDUAL RESULTELITE MEN"
 *   "INDIVIDUAL RESULTU23 WOMEN"
 *   "INDIVIDUAL RESULTUCI XCO JUNIOR SERIES MEN"
 */
function detectCategoryFromHeader(
  text: string
): { ageCategory: string; gender: string } | null {
  const match = text.match(
    /RESULT.*?(ELITE|U23|JUNIOR)\s+(?:SERIES\s+)?(MEN|WOMEN)/i
  );
  if (!match) return null;

  return {
    ageCategory: match[1].toLowerCase(),
    gender: match[2].toLowerCase() === "women" ? "women" : "men",
  };
}

/**
 * Parse the name/nat/team line.
 * Format: "{LASTNAME}{FirstName}{NAT}  {Team}"
 * Uses uppercase→lowercase boundary to split last/first name.
 */
function parseNameLine(
  line: string
): { lastName: string; firstName: string; nationality: string; team: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 5) return null;

  // Must start with an uppercase letter (beginning of last name)
  if (!/^\p{Lu}/u.test(trimmed)) return null;

  // Find nationality: 3 uppercase letters (or ***) that follow a lowercase letter or period
  const natMatch = trimmed.match(/([\p{Ll}.])\s*(\p{Lu}{3}|\*{3})/u);
  if (!natMatch || natMatch.index === undefined) return null;

  const namesPart = trimmed.substring(0, natMatch.index + 1);
  const nationality = natMatch[2];
  const team = trimmed.substring(natMatch.index + natMatch[0].length).trim();

  // Split last name from first name using uppercase→lowercase boundary
  let splitPos = -1;
  for (let i = 1; i < namesPart.length; i++) {
    if (/\p{Ll}/u.test(namesPart[i]) && /\p{Lu}/u.test(namesPart[i - 1])) {
      splitPos = i - 1;
      break;
    }
  }

  if (splitPos <= 0) return null;

  const lastName = namesPart.substring(0, splitPos).trim();
  const firstName = namesPart.substring(splitPos).trim();

  if (!lastName || !firstName) return null;

  return { lastName, firstName, nationality, team };
}

/**
 * Parse the time/status line (3rd line of each rider group).
 * Returns time info, or DNF/DNS status.
 */
function parseTimeLine(
  line: string
): { timeSeconds: number | null; laps: number | null; dnf: boolean; dns: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // DNS
  if (/^DNS$/i.test(trimmed)) {
    return { timeSeconds: null, laps: null, dnf: false, dns: true };
  }

  // DNF
  if (/^DNF$/i.test(trimmed)) {
    return { timeSeconds: null, laps: null, dnf: true, dns: false };
  }

  // Lapped/DNF: "-N LAP"
  const lapMatch = trimmed.match(/^-(\d+)\s*LAP$/i);
  if (lapMatch) {
    return { timeSeconds: null, laps: null, dnf: true, dns: false };
  }

  // Normal time: "H:MM:SS" followed by laps count (concatenated)
  // Examples: "1:15:087" → time=1:15:08, laps=7; "0:55:554" → time=0:55:55, laps=4
  const timeMatch = trimmed.match(/^(\d+:\d{2}:\d{2})(\d+)?$/);
  if (timeMatch) {
    const timeSeconds = parseHmsToSeconds(timeMatch[1]);
    const laps = timeMatch[2] ? parseInt(timeMatch[2], 10) : null;
    return { timeSeconds, laps, dnf: false, dns: false };
  }

  return null;
}

/**
 * Parse H:MM:SS time format to seconds.
 */
function parseHmsToSeconds(time: string): number | null {
  if (!time) return null;

  const parts = time.split(":").map((p) => parseInt(p, 10));

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return null;
}

/**
 * Check if a line is a header/metadata line that should be skipped.
 */
function isHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^CROSS-COUNTRY/i.test(t)) return true;
  if (/^(SUN|MON|TUE|WED|THU|FRI|SAT)\s/i.test(t)) return true;
  if (/^INDIVIDUAL\s+RESULT/i.test(t)) return true;
  if (/^Pos\s*BIB/i.test(t)) return true;
  return false;
}

/**
 * Check if a line is a digit line (pos+bib or just bib).
 * Handles both "15" (concatenated) and "1   102" (space-separated) formats.
 */
function isDigitLine(line: string): boolean {
  return /^\d+(\s+\d+)?$/.test(line.trim());
}

/**
 * Parse a digit line into position and bib.
 * Format A (space-separated): "1   102" → { position: 1, bib: 102 }
 * Format B (concatenated): "15" → needs expectedPos to split
 * Format C (bib only, DNF/DNS): "217" → { position: 0, bib: 217 }
 */
function parseDigitLine(
  line: string,
  expectedPos: number,
  hasPosition: boolean
): { position: number; bib: number } {
  const trimmed = line.trim();

  // Format A: space-separated "1   102"
  const spaceSplit = trimmed.match(/^(\d+)\s+(\d+)$/);
  if (spaceSplit) {
    return {
      position: hasPosition ? parseInt(spaceSplit[1], 10) : 0,
      bib: hasPosition ? parseInt(spaceSplit[2], 10) : parseInt(spaceSplit[1], 10),
    };
  }

  // Format B/C: concatenated digits "15" or "217"
  if (hasPosition) {
    const posStr = String(expectedPos);
    if (trimmed.startsWith(posStr) && trimmed.length > posStr.length) {
      const bib = parseInt(trimmed.substring(posStr.length), 10);
      if (bib > 0) {
        return { position: expectedPos, bib };
      }
    }
  }

  // Fallback: treat as bib only
  return { position: 0, bib: parseInt(trimmed, 10) };
}

/**
 * Parse a UCI results PDF buffer into structured results.
 */
export async function parseUciResultsPdf(
  buffer: Buffer
): Promise<ParsedUciResults | null> {
  try {
    const data = await pdfParse(buffer);
    const text: string = data.text;

    console.log(`[UCI-Results] Parsing PDF, ${text.length} chars of text`);

    // Detect category and gender from header
    const categoryInfo = detectCategoryFromHeader(text);
    if (!categoryInfo) {
      console.log("[UCI-Results] Could not detect category from header");
      return null;
    }

    console.log(
      `[UCI-Results] Detected: ${categoryInfo.ageCategory} ${categoryInfo.gender}`
    );

    // Filter out header/empty lines
    const lines = text.split("\n").filter((l) => !isHeaderLine(l));

    const results: UciResultEntry[] = [];
    let nextExpectedPos = 1;
    let i = 0;

    while (i < lines.length) {
      const line1 = lines[i]?.trim();
      if (!line1) {
        i++;
        continue;
      }

      // Line 1 must be digits (possibly space-separated pos + bib)
      if (!isDigitLine(line1)) {
        i++;
        continue;
      }

      // Need at least 2 more lines for name + time/status
      if (i + 2 >= lines.length) {
        // Check if we have name line + nothing (incomplete last entry)
        if (i + 1 < lines.length) {
          const nameParsed = parseNameLine(lines[i + 1]);
          if (nameParsed) {
            const { bib } = parseDigitLine(line1, nextExpectedPos, false);
            results.push({
              position: 0,
              bibNumber: bib,
              ...nameParsed,
              timeSeconds: null,
              laps: null,
              dnf: false,
              dns: true,
            });
          }
        }
        break;
      }

      // Line 2: name/nat/team
      const nameParsed = parseNameLine(lines[i + 1]);
      if (!nameParsed) {
        i++;
        continue;
      }

      // Line 3: time/status
      const timeParsed = parseTimeLine(lines[i + 2]);
      if (!timeParsed) {
        i++;
        continue;
      }

      // Determine if this entry has a position:
      // - DNF (explicit "DNF") and DNS entries have no position
      // - Lapped riders ("-N LAP") and normal finishers have positions
      const isDnfOrDns =
        timeParsed.dns || /^DNF$/i.test(lines[i + 2]?.trim());
      const hasPosition = !isDnfOrDns;

      const { position, bib } = parseDigitLine(
        line1,
        nextExpectedPos,
        hasPosition
      );

      if (hasPosition && position > 0) {
        nextExpectedPos = position + 1;
      }

      results.push({
        position,
        bibNumber: bib,
        ...nameParsed,
        ...timeParsed,
      });

      i += 3;
    }

    console.log(
      `[UCI-Results] Parsed ${results.length} results (${results.filter((r) => r.dnf).length} DNF, ${results.filter((r) => r.dns).length} DNS)`
    );

    return {
      ageCategory: categoryInfo.ageCategory,
      gender: categoryInfo.gender,
      results,
    };
  } catch (error) {
    console.error("[UCI-Results] Error parsing PDF:", error);
    return null;
  }
}

/**
 * Fetch and parse a UCI results PDF from URL
 */
export async function parseUciResultsPdfUrl(
  url: string
): Promise<ParsedUciResults | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return parseUciResultsPdf(Buffer.from(buffer));
  } catch (error) {
    console.error(`[UCI-Results] Error fetching PDF from ${url}:`, error);
    return null;
  }
}
