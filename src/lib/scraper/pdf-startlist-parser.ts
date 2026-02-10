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
 * Format: {bib 1-3 digits}{UCI ID 11 digits}{LASTNAME ALL CAPS}{FirstName TitleCase}{NAT 3 chars}{TeamName}{M|W}
 */
function parseRiderLine(line: string): Omit<StartlistEntry, "category"> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 20) return null;

  // Step 1: Extract bib number (1-3 digits) and UCI ID (11 digits starting with 10)
  const headerMatch = trimmed.match(/^(\d{1,3})(10\d{9})/);
  if (!headerMatch) return null;

  const bib = parseInt(headerMatch[1]);
  const uciId = headerMatch[2];
  let rest = trimmed.substring(headerMatch[0].length);

  // Step 2: Gender is the last character (M or W)
  const genderChar = rest.charAt(rest.length - 1);
  if (genderChar !== "M" && genderChar !== "W") return null;
  rest = rest.substring(0, rest.length - 1);

  // Step 3: Find nationality - 3 uppercase letters (or ***) that follow a lowercase letter or period
  // The period handles middle initials like "Martin E.NOR", space handles "Lisa NOR"
  const natMatch = rest.match(/([\p{Ll}.])\s*(\p{Lu}{3}|\*{3})/u);
  if (!natMatch || natMatch.index === undefined) return null;

  const namesPart = rest.substring(0, natMatch.index + 1); // Up to and including the last char of first name
  const nationality = natMatch[2];
  const teamName = rest.substring(natMatch.index + natMatch[0].length).trim();

  // Step 4: Split last name from first name
  // Last name is ALL CAPS (uppercase letters, spaces, hyphens, apostrophes)
  // First name starts where an uppercase letter is followed by a lowercase letter
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

  return {
    bibNumber: bib,
    uciId: uciId === "10000000000" ? null : uciId,
    lastName,
    firstName,
    nationality,
    teamName: teamName || null,
    gender: genderChar as "M" | "W",
  };
}

/**
 * Parse startlist from extracted PDF text (direct parsing, no AI)
 */
export function parseStartlistText(text: string): ParsedStartlistData {
  console.log(`[PDF-Startlist] Parsing ${text.length} chars of text (direct parser)...`);

  // Find all category section boundaries
  const allCategories = ["ELITE", "U23", "JUNIOR", "CADETE", "MASTER"];
  const sectionStarts: { category: string; index: number }[] = [];

  for (const cat of allCategories) {
    const idx = text.indexOf(`Category ${cat}`);
    if (idx !== -1) {
      sectionStarts.push({ category: cat, index: idx });
    }
  }
  sectionStarts.sort((a, b) => a.index - b.index);

  console.log(`[PDF-Startlist] Found ${sectionStarts.length} sections: ${sectionStarts.map((s) => s.category).join(", ")}`);

  // Extract each section's text
  const sections = new Map<string, string>();
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].index;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : text.length;
    sections.set(sectionStarts[i].category, text.substring(start, end));
  }

  // Parse riders from each supported category
  const supportedCategories = ["ELITE", "U23", "JUNIOR"];
  const allEntries: StartlistEntry[] = [];
  const foundCategories: string[] = [];

  for (const category of supportedCategories) {
    const sectionText = sections.get(category);
    if (!sectionText) continue;

    const lines = sectionText.split("\n");
    let categoryCount = 0;

    for (const line of lines) {
      const entry = parseRiderLine(line);
      if (entry) {
        allEntries.push({ ...entry, category });
        categoryCount++;
      }
    }

    if (categoryCount > 0) {
      foundCategories.push(category);
      console.log(`[PDF-Startlist] ${category}: ${categoryCount} riders`);
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
