/**
 * normalize.ts — Shared data normalization utilities
 *
 * Use these in all agent scripts to ensure consistent country codes,
 * rider name formatting, and category slugs before writing to the DB.
 */

// ─── Country code normalization ───────────────────────────────────────────────
// Canonical format: UCI 3-letter codes (DEN, GER, NED, etc.)
// Sources of bad data: ISO 3166-1 alpha-3, PCS 2-letter CSS flags (stored as "title"),
//   full English names from Wikipedia/PCS title attributes.

const COUNTRY_NORM: Record<string, string> = {
  // ISO 3166-1 alpha-3 → UCI
  DNK: "DEN", DEU: "GER", NLD: "NED", PRT: "POR", CHE: "SUI",
  HRV: "CRO", SVN: "SLO", GBR: "GBR",
  // PCS 2-letter CSS class codes (extracted from "flag XX" class, uppercased)
  // These come from flag class names like "flag nl" → "NL"
  NL: "NED", BE: "BEL", FR: "FRA", DE: "GER", IT: "ITA", ES: "ESP",
  GB: "GBR", DK: "DEN", NO: "NOR", SE: "SWE", CH: "SUI", AT: "AUT",
  PT: "POR", PL: "POL", CZ: "CZE", SK: "SVK", SI: "SLO", HR: "CRO",
  HU: "HUN", RO: "ROU", BG: "BUL", EE: "EST", LV: "LAT", LT: "LTU",
  FI: "FIN", GR: "GRE", CY: "CYP", LU: "LUX", IE: "IRL", IS: "ISL",
  RU: "RUS", UA: "UKR", BY: "BLR", RS: "SRB", BA: "BIH", ME: "MNE",
  MK: "MKD", AL: "ALB", MD: "MDA", AM: "ARM", GE: "GEO", AZ: "AZE",
  KZ: "KAZ", UZ: "UZB",
  US: "USA", CA: "CAN", AU: "AUS", NZ: "NZL", ZA: "RSA",
  JP: "JPN", KR: "KOR", CN: "CHN", TW: "TPE", TH: "THA", IN: "IND",
  CO: "COL", AR: "ARG", BR: "BRA", MX: "MEX", CL: "CHI", PE: "PER",
  EC: "ECU", VE: "VEN", BO: "BOL",
  ER: "ERI", ET: "ETH", NA: "NAM",
  IL: "ISR", TR: "TUR", AD: "AND",
  // Full English country names → UCI (from PCS title/alt attributes)
  Norway: "NOR", Sweden: "SWE", Spain: "ESP", France: "FRA", Italy: "ITA",
  Germany: "GER", Switzerland: "SUI", Netherlands: "NED", Belgium: "BEL",
  Denmark: "DEN", "United States": "USA", "United Kingdom": "GBR", Poland: "POL",
  "Czech Republic": "CZE", Czechia: "CZE", Australia: "AUS", Canada: "CAN",
  Colombia: "COL", Slovenia: "SLO", Croatia: "CRO", Portugal: "POR", Austria: "AUT",
  Slovakia: "SVK", Finland: "FIN", Hungary: "HUN", Romania: "ROU", Russia: "RUS",
  Ukraine: "UKR", Thailand: "THA", Turkey: "TUR", Serbia: "SRB",
  "South Korea": "KOR", Korea: "KOR", Japan: "JPN", China: "CHN", Brazil: "BRA",
  Argentina: "ARG", Mexico: "MEX", "South Africa": "RSA", "New Zealand": "NZL",
  Israel: "ISR", Kazakhstan: "KAZ", Luxembourg: "LUX", Ireland: "IRL", Greece: "GRE",
  Lithuania: "LTU", Latvia: "LAT", Estonia: "EST", Bulgaria: "BUL", Belarus: "BLR",
  Eritrea: "ERI", Ethiopia: "ETH", Cuba: "CUB", Ecuador: "ECU", Peru: "PER",
  Chile: "CHI", Venezuela: "VEN", Namibia: "NAM", Andorra: "AND", Albania: "ALB",
  Algeria: "ALG", Bolivia: "BOL", Cyprus: "CYP", "Dominican Republic": "DOM",
  Guam: "GUM", Guatemala: "GUA", India: "IND", Philippines: "PHI",
  "Puerto Rico": "PUR", "Costa Rica": "CRC", Singapore: "SIN", Bermuda: "BER",
  Georgia: "GEO", Armenia: "ARM", Azerbaijan: "AZE", Uzbekistan: "UZB",
  Taiwan: "TPE", "Chinese Taipei": "TPE",
  Liechtenstein: "LIE", Monaco: "MON",
};

/**
 * Normalize a country string to a UCI 3-letter code.
 * Returns null for unknown/garbage values.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "***") return null;
  // Already a valid 3-letter UCI code (not in our remap table) — pass through
  if (/^[A-Z]{3}$/.test(trimmed) && !COUNTRY_NORM[trimmed]) return trimmed;
  return COUNTRY_NORM[trimmed] ?? null;
}

// ─── Category slug normalization ──────────────────────────────────────────────
// Canonical: "elite-men", "elite-women", "u23-men", "u23-women", "junior-men", "junior-women"

const CATEGORY_SLUG_ALIASES: Record<string, string> = {
  "elite men": "elite-men",
  "elite women": "elite-women",
  "u23 men": "u23-men",
  "u23 women": "u23-women",
  "under-23 men": "u23-men",
  "under-23 women": "u23-women",
  "junior men": "junior-men",
  "junior women": "junior-women",
  "elite-m": "elite-men",
  "elite-w": "elite-women",
  "me": "elite-men",
  "we": "elite-women",
  "mj": "junior-men",
  "wj": "junior-women",
};

export function normalizeCategorySlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return CATEGORY_SLUG_ALIASES[lower] ?? lower;
}

// ─── Rider name normalization ─────────────────────────────────────────────────
// Canonical: "Firstname Lastname" (Title Case, accents preserved)
// PCS format: "LASTNAME Firstname" → needs inversion

/**
 * Convert PCS-style "VAN DER POEL Mathieu" to "Mathieu van der Poel".
 * If name is already title-cased, returns as-is (normalized).
 */
export function normalizeRiderName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Detect PCS format: first token is all-uppercase and has 2+ chars
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && parts[0] === parts[0].toUpperCase() && parts[0].length >= 2 && /^[A-Z]+$/.test(parts[0].replace(/['-]/g, ''))) {
    // Last word(s) are the first name (PCS puts first name last)
    // Convention: all-CAPS words are the last name(s), then first name(s)
    const upperParts = parts.filter(p => p === p.toUpperCase() && /^[A-Z'-]+$/.test(p));
    const lowerParts = parts.filter(p => p !== p.toUpperCase() || !/^[A-Z'-]+$/.test(p));
    if (lowerParts.length > 0) {
      // "POEL Mathieu" → "Mathieu Poel", "VAN DER POEL Mathieu" → "Mathieu Van Der Poel"
      const lastName = upperParts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      const firstName = lowerParts.join(" ");
      return `${firstName} ${lastName}`;
    }
  }

  // Already normal: apply title case
  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
