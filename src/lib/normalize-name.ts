/**
 * Shared name normalization utilities.
 *
 * Canonical home for stripAccents, normalizeRiderName, and normalizeFuzzy
 * so they aren't duplicated across dozens of files.
 */

/**
 * Strip accents/diacritical marks from a string.
 */
export function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize rider name for matching.
 * Handles formats:
 * - "LAST, First" → "First Last"
 * - "LASTNAME Firstname" (UCI/XCOdata format) → "Firstname Lastname"
 * - Plain "First Last" → title case normalization
 */
export function normalizeRiderName(name: string): string {
  let normalized = name.trim().replace(/\s+/g, " ");

  // Handle "LAST, First" format
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  } else {
    // Detect "LASTNAME Firstname" UCI format:
    // When the name has 2+ words and the first N words are ALL_CAPS (last name),
    // and the remaining word(s) have mixed case (first name).
    // e.g. "SÖDERQVIST Jakob" → "Jakob Söderqvist"
    //      "VAN DER POEL Mathieu" → "Mathieu Van Der Poel"
    const words = normalized.split(" ");
    if (words.length >= 2) {
      // Strip accents for case detection
      const stripAcc = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // Find the split point: last consecutive all-caps word from the start
      let lastCapIdx = -1;
      for (let i = 0; i < words.length - 1; i++) {
        const w = stripAcc(words[i]);
        if (w === w.toUpperCase() && w.length > 1 && /[A-Za-z]/.test(w)) {
          lastCapIdx = i;
        } else {
          break;
        }
      }
      if (lastCapIdx >= 0) {
        // Split: words[0..lastCapIdx] are the last name, rest is first name
        const lastNameParts = words.slice(0, lastCapIdx + 1);
        const firstNameParts = words.slice(lastCapIdx + 1);
        normalized = [...firstNameParts, ...lastNameParts].join(" ");
      }
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

/**
 * Normalize a name for fuzzy matching: lowercase, strip accents,
 * remove non-alpha characters (except spaces), and trim.
 */
export function normalizeFuzzy(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}
