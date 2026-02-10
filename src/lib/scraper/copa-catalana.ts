/**
 * Vola Timing Results Parser
 *
 * Parses race results from Vola Timing PDF files.
 * Used by Copa Catalana BTT and Super Cup Massi events.
 */

import { extractText } from "unpdf";

export interface CopaCatalanaResult {
  position: number;
  bibNumber: number;
  name: string; // Format: "SURNAME Firstname"
  category: string; // "Sub23", "Elit", "Élite", "Junior", etc.
  team: string;
  laps: number;
  time: string; // "1h14:46.07"
  gap: string | null; // "+9.38" or "+1 Volta/Vuelta" or null for winner
  timeGapSeconds: number | null; // Parsed gap in seconds
  dnf: boolean;
  dns: boolean;
}

export interface CopaCatalanaParsedRace {
  eventName: string;
  seriesName: string;
  date: string;
  location: string;
  categories: string[];
  results: CopaCatalanaResult[];
}

/**
 * Fetch and parse a Copa Catalana PDF from URL
 */
export async function parseCopaCatalanaPdfUrl(
  url: string
): Promise<CopaCatalanaParsedRace | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return parseCopaCatalanaPdf(Buffer.from(buffer));
  } catch (error) {
    console.error("Error fetching Copa Catalana PDF:", error);
    return null;
  }
}

/**
 * Parse a Copa Catalana PDF buffer
 */
export async function parseCopaCatalanaPdf(
  buffer: Buffer
): Promise<CopaCatalanaParsedRace | null> {
  try {
    // Extract text using unpdf (server-side compatible)
    // Convert Buffer to Uint8Array as required by unpdf
    const uint8Array = new Uint8Array(buffer);
    const { text: fullText } = await extractText(uint8Array, { mergePages: true });

    // Extract event info
    const eventNameMatch = fullText.match(/SANT FRUITÓS DE BAGES|([A-Z\s]+DE\s+[A-Z]+)/);
    const eventName = eventNameMatch ? eventNameMatch[0].trim() : "Copa Catalana";

    const dateMatch = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "";

    // Parse results using regex
    // Pattern: position bib NAME Category TEAM laps time [gap]
    // Example: "1   8   SINUÉS MICÓ Mario   Elit   AMUNT T-BIKES   6   1h14:40.52"
    // Example: "2 601 BOSCH PICO Nuria F.Elit MASSI 5 1h15:41.53"
    // Handle both male (Elit, Sub23) and female (F.Elit, F.Sub23) categories
    // Time formats: "1h14:40.52", "1:14:40.52", "14:40.52", "1h14:40", "14:40"
    // Note: Section headers can appear before position 1, so we use a word boundary or allow category prefix
    const resultPattern = /(?:^|(?:F\.?Master\s*\d+|Master\s*\d+|F\.?Junior|Junior|F\.?Élite?|F\.?Elit|Élite?|Elit|F\.?Sub23|Sub23|F\.?Cadete?|Cadete?)\s+)?(\d+)\s+(\d+)\s+(.+?)\s+(F\.?Master\s*\d+|F\.?Sub23|F\.?Élite?|F\.?Elit|F\.?Junior|F\.?Cadete?|Sub23|Élite?|Elit|Junior|Cadete?|Master\s*\d+)\s+(.+?)\s+(\d+)\s+(\d+[h:]?\d*:\d+(?:\.\d+)?)(?:\s+(\+[\d:\.]+|\+\d+\s*(?:Volta|Vuelta)))?/gim;

    const results: CopaCatalanaResult[] = [];
    const categoriesFound = new Set<string>();

    let match;
    while ((match = resultPattern.exec(fullText)) !== null) {
      const category = match[4];
      categoriesFound.add(category);

      const gap = match[8] || null;
      results.push({
        position: parseInt(match[1], 10),
        bibNumber: parseInt(match[2], 10),
        name: match[3].trim(),
        category,
        team: match[5].trim(),
        laps: parseInt(match[6], 10),
        time: match[7],
        gap,
        timeGapSeconds: parseGapToSeconds(gap),
        dnf: false,
        dns: false,
      });
    }

    // Parse DNS (No Sortits / No-Salidos)
    const dnsSection = fullText.match(/(?:No Sortits|No-Salidos)([\s\S]+?)(?:Abandonos|Abandons|F\.?Elit|F\.?Élite|Elit|Élite?|F\.?Sub23|Sub23|F\.?Junior|Junior|F\.?Cadete?|Cadete?|F\.?Master|Master|$)/i);
    if (dnsSection) {
      const dnsPattern = /(\d+)\s+([A-ZÁÉÍÓÚÑÇÀ-ÿ][A-ZÁÉÍÓÚÑÇÀa-záéíóúñçà-ÿ\s'-]+?)\s+(F\.?Master\s*\d+|F\.?Sub23|F\.?Élite?|F\.?Elit|F\.?Junior|F\.?Cadete?|Sub23|Élite?|Elit|Junior|Cadete?|Master\s*\d+)\s+([A-Z0-9\s\-\.]+?)(?=\s+\d+\s+[A-Z]|\s*$)/gi;
      let dnsMatch;
      while ((dnsMatch = dnsPattern.exec(dnsSection[1])) !== null) {
        results.push({
          position: 0,
          bibNumber: parseInt(dnsMatch[1], 10),
          name: dnsMatch[2].trim(),
          category: dnsMatch[3],
          team: dnsMatch[4].trim(),
          laps: 0,
          time: "",
          gap: null,
          timeGapSeconds: null,
          dnf: false,
          dns: true,
        });
      }
    }

    // Parse DNF (Abandons / Abandonos)
    const dnfSection = fullText.match(/(?:Abandonos|Abandons)([\s\S]+?)(?:No Sortits|No-Salidos|F\.?Elit|F\.?Élite|Elit|Élite?|F\.?Sub23|Sub23|F\.?Junior|Junior|F\.?Cadete?|Cadete?|F\.?Master|Master|$)/i);
    if (dnfSection) {
      const dnfPattern = /(\d+)\s+([A-ZÁÉÍÓÚÑÇÀ-ÿ][A-ZÁÉÍÓÚÑÇÀa-záéíóúñçà-ÿ\s'-]+?)\s+(F\.?Master\s*\d+|F\.?Sub23|F\.?Élite?|F\.?Elit|F\.?Junior|F\.?Cadete?|Sub23|Élite?|Elit|Junior|Cadete?|Master\s*\d+)\s+([A-Z0-9\s\-\.]+?)(?=\s+\d+\s+[A-Z]|\s*$)/gi;
      let dnfMatch;
      while ((dnfMatch = dnfPattern.exec(dnfSection[1])) !== null) {
        results.push({
          position: 0,
          bibNumber: parseInt(dnfMatch[1], 10),
          name: dnfMatch[2].trim(),
          category: dnfMatch[3],
          team: dnfMatch[4].trim(),
          laps: 0,
          time: "",
          gap: null,
          timeGapSeconds: null,
          dnf: true,
          dns: false,
        });
      }
    }

    // Deduplicate results by bib number (some may appear in multiple sections)
    const uniqueResults = new Map<number, CopaCatalanaResult>();
    for (const r of results) {
      if (!uniqueResults.has(r.bibNumber) || r.position > 0) {
        uniqueResults.set(r.bibNumber, r);
      }
    }

    return {
      eventName,
      seriesName: "Copa Catalana Internacional BTT",
      date,
      location: eventName,
      categories: Array.from(categoriesFound),
      results: Array.from(uniqueResults.values()).sort((a, b) => {
        // Sort by category first, then by position
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        if (a.position === 0) return 1;
        if (b.position === 0) return -1;
        return a.position - b.position;
      }),
    };
  } catch (error) {
    console.error("Error parsing Copa Catalana PDF:", error);
    return null;
  }
}

/**
 * Map Copa Catalana category to our internal format
 */
export function mapCopaCatalanaCategory(
  category: string
): { ageCategory: string; gender: string } | null {
  // Normalize: lowercase, strip dots, spaces, and accents
  const cat = category
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip accent marks

  // Female categories (F.Elit, F.Élite, F.Sub23, F.Junior, FElit, etc.)
  if (cat === "felit" || cat === "felite") {
    return { ageCategory: "elite", gender: "women" };
  }
  if (cat === "fsub23") {
    return { ageCategory: "u23", gender: "women" };
  }
  if (cat === "fjunior") {
    return { ageCategory: "junior", gender: "women" };
  }

  // Male categories (Elit, Élite, Elite, Sub23, Junior)
  if (cat === "elit" || cat === "elite") {
    return { ageCategory: "elite", gender: "men" };
  }
  if (cat === "sub23") {
    return { ageCategory: "u23", gender: "men" };
  }
  if (cat === "junior") {
    return { ageCategory: "junior", gender: "men" };
  }

  // Ignore master/cadet categories for now
  return null;
}

/**
 * Normalize name from "SURNAME Firstname" to "Firstname Surname"
 */
export function normalizeName(name: string): string {
  // Split by spaces
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;

  // Find where surname ends (all caps) and firstname begins
  let surnameEnd = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === parts[i].toUpperCase() && parts[i].length > 1) {
      surnameEnd = i;
    } else {
      break;
    }
  }

  // If everything is uppercase, try to split differently
  if (surnameEnd === parts.length - 1) {
    // Take last word as firstname
    const firstname = capitalizeWord(parts[parts.length - 1]);
    const surname = parts.slice(0, -1).map(capitalizeWord).join(" ");
    return `${firstname} ${surname}`;
  }

  // Reconstruct as "Firstname Surname"
  const surnames = parts.slice(0, surnameEnd + 1);
  const firstnames = parts.slice(surnameEnd + 1);

  if (firstnames.length === 0) {
    return name;
  }

  const formattedSurname = surnames.map(capitalizeWord).join(" ");
  const formattedFirstname = firstnames.join(" ");

  return `${formattedFirstname} ${formattedSurname}`;
}

function capitalizeWord(word: string): string {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Parse time string to milliseconds
 */
export function parseTime(timeStr: string): number | null {
  if (!timeStr) return null;

  // Format: "1h14:46.07" or "14:46.07"
  const match = timeStr.match(/(?:(\d+)h)?(\d+):(\d+)\.(\d+)/);
  if (!match) return null;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const hundredths = parseInt(match[4], 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + hundredths * 10;
}

/**
 * Parse a gap string to seconds (integer).
 * Formats: "+9.38" (seconds.hundredths), "+1:23.45" (min:sec.hh), "+1 Volta"/"Vuelta" (lapped)
 * Returns null for lapped riders or unparseable gaps.
 */
export function parseGapToSeconds(gap: string | null): number | null {
  if (!gap) return null;

  // Lapped riders
  if (/Volta|Vuelta/i.test(gap)) return null;

  // Strip leading +
  const cleaned = gap.replace(/^\+/, "");

  // Format: MM:SS.hh or M:SS.hh
  const minSecMatch = cleaned.match(/^(\d+):(\d+)\.(\d+)$/);
  if (minSecMatch) {
    const mins = parseInt(minSecMatch[1], 10);
    const secs = parseInt(minSecMatch[2], 10);
    return mins * 60 + secs;
  }

  // Format: SS.hh (just seconds)
  const secMatch = cleaned.match(/^(\d+)\.(\d+)$/);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }

  return null;
}
