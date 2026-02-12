/**
 * PDF Startlist Parser
 *
 * Parses UCI-style startlist PDFs using direct text parsing.
 * No AI needed - the data is structured tabular text.
 */

export interface StartlistEntry {
  bibNumber: number | null;
  uciId: string | null;
  firstName: string;
  lastName: string;
  nationality: string;
  teamName: string | null;
  gender: "M" | "W";
  category: string; // Raw category from PDF (ELITE, U23, JUNIOR, etc.)
}

export interface ParsedStartlistData {
  eventName: string | null;
  date: string | null;
  location: string | null;
  categories: string[];
  entries: StartlistEntry[];
}

export interface CategoryMapping {
  rawCategory: string;
  ageCategory: "elite" | "u23" | "junior";
  gender: "men" | "women";
  key: string;
  displayName: string;
}

/**
 * Parse a single rider line from UCI-style startlist text.
 * Format A (with gender suffix): {bib}{UCI ID}{LASTNAME}{FirstName}{NAT}{Team}{M|W}
 * Format B (Chelva-style, no gender): {bib}{UCI ID}{LASTNAME}{FirstName}{NAT}{Team}{UCI Rank?}
 *
 * When sectionGender is provided, gender suffix on the line is not required.
 */
function parseRiderLine(
  line: string,
  sectionGender?: "M" | "W"
): Omit<StartlistEntry, "category"> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 20) return null;

  // Step 1: Extract bib number (1-3 digits) and UCI ID (11 digits starting with 10)
  const headerMatch = trimmed.match(/^(\d{1,3})(10\d{9})/);
  if (!headerMatch) return null;

  const bib = parseInt(headerMatch[1]);
  const uciId = headerMatch[2];
  let rest = trimmed.substring(headerMatch[0].length);

  // Step 2: Check if gender is the last character (M or W) — Format A
  let gender: "M" | "W" | null = null;
  const lastChar = rest.charAt(rest.length - 1);
  if (lastChar === "M" || lastChar === "W") {
    // Only treat as gender if the char before it is NOT a letter (to avoid team names ending in M/W)
    const beforeLast = rest.length >= 2 ? rest.charAt(rest.length - 2) : "";
    if (!beforeLast || /\s/.test(beforeLast) || /\d/.test(beforeLast)) {
      gender = lastChar;
      rest = rest.substring(0, rest.length - 1);
    }
  }

  // Use section gender as fallback
  if (!gender) {
    gender = sectionGender || null;
  }

  // If we still have no gender, strip trailing UCI rank/extra data
  // Chelva lines end with: number (UCI rank), "NCh" + number, "1ºaño", "2ºaño", master cats, or nothing
  rest = rest.replace(/(?:NCh)?\d*$/, "").trim();
  // Strip trailing year indicators for cadete/master (1ºaño, 2ºaño, M30, M40, M50, etc.)
  rest = rest.replace(/(?:\d+ºaño|M\d{2})$/, "").trim();

  // Step 3: Find nationality - 3 uppercase letters (or ***) that follow a lowercase letter or period
  const natMatch = rest.match(/([\p{Ll}.])\s*(\p{Lu}{3}|\*{3})/u);
  if (!natMatch || natMatch.index === undefined) return null;

  const namesPart = rest.substring(0, natMatch.index + 1);
  const nationality = natMatch[2];
  const teamName = rest.substring(natMatch.index + natMatch[0].length).trim();

  // Step 4: Split last name from first name
  // Last name is ALL CAPS; first name starts where uppercase is followed by lowercase
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

  // If we still have no gender and couldn't determine it, default to M
  if (!gender) gender = "M";

  return {
    bibNumber: bib,
    uciId: uciId === "10000000000" ? null : uciId,
    lastName,
    firstName,
    nationality,
    teamName: teamName || null,
    gender,
  };
}

/**
 * Detect section headers in the PDF text.
 * Supports two formats:
 *   Format A: "Category ELITE" (older style)
 *   Format B: "Start list ELITE MEN ...", "Start list MEN U23 ..." (Chelva/UCI style)
 */
interface SectionInfo {
  category: string; // ELITE, U23, JUNIOR, etc.
  gender: "M" | "W" | null;
  index: number;
}

function detectSections(text: string): SectionInfo[] {
  const sections: SectionInfo[] = [];

  // Format A: "Category ELITE", "Category U23", etc.
  const catRegex = /Category\s+(ELITE|U23|JUNIOR|CADETE|MASTER)/gi;
  let match;
  while ((match = catRegex.exec(text)) !== null) {
    sections.push({
      category: match[1].toUpperCase(),
      gender: null, // Gender determined from individual lines in Format A
      index: match.index,
    });
  }

  // Format B: "Start list {CATEGORY} {GENDER}" or "Start list {GENDER} {CATEGORY}"
  // Examples: "Start list ELITE MEN", "Start list ELITE WOMEN", "Start list MEN U23",
  //           "Start list MEN UCI XCO JUNIOR SERIES", "Start list WOMEN UCI XCO JUNIOR SERIES"
  const startListRegex =
    /Start\s+list\s+((?:ELITE|U23|JUNIOR|MEN|WOMEN)[\w\s]*?)(?:\s+\d+h\d+|\s+INTERNACIONALES|\s+\d{1,2}:\d{2})/gi;
  while ((match = startListRegex.exec(text)) !== null) {
    const desc = match[1].toUpperCase().trim();

    // Extract gender
    let gender: "M" | "W" | null = null;
    if (desc.includes("WOMEN")) gender = "W";
    else if (desc.includes("MEN")) gender = "M";

    // Extract category
    let category: string;
    if (desc.includes("JUNIOR")) category = "JUNIOR";
    else if (desc.includes("U23")) category = "U23";
    else if (desc.includes("ELITE")) category = "ELITE";
    else if (desc.includes("CADETE")) category = "CADETE";
    else if (desc.includes("MASTER")) category = "MASTER";
    else continue;

    sections.push({ category, gender, index: match.index });
  }

  // Sort by position and deduplicate
  sections.sort((a, b) => a.index - b.index);
  return sections;
}

/**
 * Parse startlist from extracted PDF text (direct parsing, no AI)
 */
export function parseStartlistText(text: string): ParsedStartlistData {
  console.log(`[PDF-Startlist] Parsing ${text.length} chars of text (direct parser)...`);

  const sectionStarts = detectSections(text);
  console.log(
    `[PDF-Startlist] Found ${sectionStarts.length} sections: ${sectionStarts.map((s) => `${s.category}(${s.gender || "?"})`).join(", ")}`
  );

  // Extract each section's text
  const sectionData: Array<{ category: string; gender: "M" | "W" | null; text: string }> = [];
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].index;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : text.length;
    sectionData.push({
      category: sectionStarts[i].category,
      gender: sectionStarts[i].gender,
      text: text.substring(start, end),
    });
  }

  // Parse riders from each supported category
  const supportedCategories = ["ELITE", "U23", "JUNIOR"];
  const allEntries: StartlistEntry[] = [];
  const foundCategories: string[] = [];

  for (const section of sectionData) {
    if (!supportedCategories.includes(section.category)) continue;

    const lines = section.text.split("\n");
    let categoryCount = 0;

    for (const line of lines) {
      const entry = parseRiderLine(line, section.gender || undefined);
      if (entry) {
        // Use section gender if available, override entry gender
        if (section.gender) {
          entry.gender = section.gender;
        }
        allEntries.push({ ...entry, category: section.category });
        categoryCount++;
      }
    }

    const genderLabel = section.gender === "W" ? "Women" : section.gender === "M" ? "Men" : "?";
    if (categoryCount > 0) {
      foundCategories.push(section.category);
      console.log(`[PDF-Startlist] ${section.category} ${genderLabel}: ${categoryCount} riders`);
    }
  }

  console.log(`[PDF-Startlist] Total: ${allEntries.length} entries across ${foundCategories.length} categories`);

  return {
    eventName: null,
    date: null,
    location: null,
    categories: foundCategories,
    entries: allEntries,
  };
}

/**
 * Async wrapper for backward compatibility with route handler
 */
export async function parseStartlistTextWithAI(text: string): Promise<ParsedStartlistData | null> {
  const result = parseStartlistText(text);
  return result.entries.length > 0 ? result : null;
}

/**
 * Map raw PDF categories to standardized format
 */
export function mapPdfCategories(rawCategories: string[]): CategoryMapping[] {
  const mappings: CategoryMapping[] = [];

  for (const raw of rawCategories) {
    const upper = raw.toUpperCase().trim();

    // Skip unsupported categories
    if (upper.includes("CADETE") || upper.includes("MASTER") || upper.includes("OPEN")) {
      continue;
    }

    let ageCategory: "elite" | "u23" | "junior";
    let gender: "men" | "women" = "men"; // Default

    // Determine age category
    if (upper.includes("ELITE") || upper === "ÉLITE" || upper === "ÉLIT") {
      ageCategory = "elite";
    } else if (upper.includes("U23") || upper.includes("SUB23") || upper.includes("SUB-23")) {
      ageCategory = "u23";
    } else if (upper.includes("JUNIOR")) {
      ageCategory = "junior";
    } else {
      // Unknown category, skip
      continue;
    }

    // Determine gender (if specified in category name)
    if (upper.includes("WOMEN") || upper.includes("FEMALE") || upper.includes("FÉMINA") || upper.includes("FEMINA")) {
      gender = "women";
    }

    const key = `${ageCategory}_${gender}`;
    const displayName = `${ageCategory === "elite" ? "Elite" : ageCategory === "u23" ? "U23" : "Junior"} ${gender === "men" ? "Men" : "Women"}`;

    // Avoid duplicates
    if (!mappings.some((m) => m.key === key)) {
      mappings.push({
        rawCategory: raw,
        ageCategory,
        gender,
        key,
        displayName,
      });
    }
  }

  return mappings;
}

/**
 * Group startlist entries by category
 * For PDFs with Gender column (like Chelva), we split by gender within each category
 */
export function groupEntriesByCategory(
  entries: StartlistEntry[],
  rawCategories: string[]
): Map<string, StartlistEntry[]> {
  const groups = new Map<string, StartlistEntry[]>();

  for (const entry of entries) {
    const rawCat = entry.category.toUpperCase().trim();

    // Skip unsupported categories
    if (rawCat.includes("CADETE") || rawCat.includes("MASTER") || rawCat.includes("OPEN")) {
      continue;
    }

    // Determine age category
    let ageCategory: string;
    if (rawCat.includes("ELITE") || rawCat === "ÉLITE" || rawCat === "ÉLIT") {
      ageCategory = "elite";
    } else if (rawCat.includes("U23") || rawCat.includes("SUB23") || rawCat.includes("SUB-23")) {
      ageCategory = "u23";
    } else if (rawCat.includes("JUNIOR")) {
      ageCategory = "junior";
    } else {
      continue; // Skip unknown
    }

    // Determine gender from entry
    const gender = entry.gender === "W" ? "women" : "men";
    const key = `${ageCategory}_${gender}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  return groups;
}
