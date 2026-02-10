/**
 * URL Utility Functions
 *
 * Helper functions for generating URL-friendly slugs and building URLs
 * for the new discipline → event → category hierarchy.
 */

/**
 * Generate a URL-friendly slug from an event name
 * Format: lowercase, hyphenated, accents removed
 * Example: "Shimano Supercup La Nucia 2026" → "shimano-supercup-la-nucia-2026"
 */
export function generateEventSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Generate a category slug from age category and gender
 * Example: "elite" + "men" → "elite-men"
 */
export function generateCategorySlug(
  ageCategory: string,
  gender: string
): string {
  return `${ageCategory.toLowerCase()}-${gender.toLowerCase()}`;
}

/**
 * Parse a category slug back into age category and gender
 * Example: "elite-men" → { ageCategory: "elite", gender: "men" }
 */
export function parseCategorySlug(slug: string): {
  ageCategory: string;
  gender: string;
} | null {
  const validAgeCategories = ["elite", "u23", "junior", "masters"];
  const validGenders = ["men", "women"];

  const parts = slug.toLowerCase().split("-");
  if (parts.length !== 2) return null;

  const [ageCategory, gender] = parts;
  if (!validAgeCategories.includes(ageCategory)) return null;
  if (!validGenders.includes(gender)) return null;

  return { ageCategory, gender };
}

/**
 * Check if a string is a valid UUID
 */
export function isUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Valid disciplines for URL routing
 */
export const VALID_DISCIPLINES = ["mtb", "road", "gravel", "cyclocross"] as const;
export type Discipline = (typeof VALID_DISCIPLINES)[number];

/**
 * Valid MTB sub-disciplines
 */
export const VALID_SUB_DISCIPLINES = ["xco", "xcc", "xce", "xcm"] as const;
export type SubDiscipline = (typeof VALID_SUB_DISCIPLINES)[number];

/**
 * Check if a string is a valid discipline
 */
export function isValidDiscipline(str: string): str is Discipline {
  return VALID_DISCIPLINES.includes(str as Discipline);
}

/**
 * Check if a string is a valid sub-discipline
 */
export function isValidSubDiscipline(str: string): str is SubDiscipline {
  return VALID_SUB_DISCIPLINES.includes(str as SubDiscipline);
}

/**
 * Build the URL for a race event
 * Example: buildEventUrl("mtb", "shimano-supercup-2026") → "/races/mtb/shimano-supercup-2026"
 */
export function buildEventUrl(discipline: string, eventSlug: string): string {
  return `/races/${discipline}/${eventSlug}`;
}

/**
 * Build the URL for a race category
 * Example: buildCategoryUrl("mtb", "shimano-supercup-2026", "elite-men") → "/races/mtb/shimano-supercup-2026/elite-men"
 */
export function buildCategoryUrl(
  discipline: string,
  eventSlug: string,
  categorySlug: string
): string {
  return `/races/${discipline}/${eventSlug}/${categorySlug}`;
}

/**
 * Build the URL for a stage
 * Example: buildStageUrl("road", "tour-de-france-2026", "elite-men", 5) → "/races/road/tour-de-france-2026/elite-men/stage-5"
 */
export function buildStageUrl(
  discipline: string,
  eventSlug: string,
  categorySlug: string,
  stageNumber: number
): string {
  return `/races/${discipline}/${eventSlug}/${categorySlug}/stage-${stageNumber}`;
}

/**
 * Build the full URL for a race, given race and optional event data
 */
export function buildRaceUrl(
  race: {
    id: string;
    discipline: string;
    categorySlug?: string | null;
    ageCategory?: string | null;
    gender?: string | null;
    stageNumber?: number | null;
  },
  event?: {
    slug?: string | null;
    discipline: string;
  } | null
): string {
  // If we have an event with a slug, use the new URL structure
  if (event?.slug) {
    const categorySlug =
      race.categorySlug ||
      (race.ageCategory && race.gender
        ? generateCategorySlug(race.ageCategory, race.gender)
        : null);

    if (categorySlug) {
      if (race.stageNumber) {
        return buildStageUrl(
          event.discipline,
          event.slug,
          categorySlug,
          race.stageNumber
        );
      }
      return buildCategoryUrl(event.discipline, event.slug, categorySlug);
    }

    // Event page without specific category
    return buildEventUrl(event.discipline, event.slug);
  }

  // Fallback to UUID-based URL for races without events or slugs
  return `/races/${race.id}`;
}

/**
 * Get display label for a discipline
 */
export function getDisciplineLabel(discipline: string): string {
  const labels: Record<string, string> = {
    mtb: "Mountain Bike",
    road: "Road",
    gravel: "Gravel",
    cyclocross: "Cyclocross",
  };
  return labels[discipline] || discipline.toUpperCase();
}

/**
 * Get short display label for a discipline
 */
export function getDisciplineShortLabel(discipline: string): string {
  const labels: Record<string, string> = {
    mtb: "MTB",
    road: "Road",
    gravel: "Gravel",
    cyclocross: "CX",
  };
  return labels[discipline] || discipline.toUpperCase();
}

/**
 * Get display label for a sub-discipline
 */
export function getSubDisciplineLabel(subDiscipline: string): string {
  const labels: Record<string, string> = {
    xco: "XCO (Cross-Country Olympic)",
    xcc: "XCC (Short Track)",
    xce: "XCE (Eliminator)",
    xcm: "XCM (Marathon)",
  };
  return labels[subDiscipline] || subDiscipline.toUpperCase();
}

/**
 * Get short display label for a sub-discipline
 */
export function getSubDisciplineShortLabel(subDiscipline: string): string {
  return subDiscipline.toUpperCase();
}

/**
 * Convert old discipline format to new format
 * Example: "mtb_xco" → { discipline: "mtb", subDiscipline: "xco" }
 */
export function convertLegacyDiscipline(oldDiscipline: string): {
  discipline: Discipline;
  subDiscipline: SubDiscipline | null;
} {
  if (oldDiscipline.startsWith("mtb_")) {
    const sub = oldDiscipline.replace("mtb_", "") as SubDiscipline;
    return {
      discipline: "mtb",
      subDiscipline: isValidSubDiscipline(sub) ? sub : "xco",
    };
  }

  // Already in new format or standard discipline
  if (isValidDiscipline(oldDiscipline)) {
    return { discipline: oldDiscipline, subDiscipline: null };
  }

  // Default to road if unknown
  return { discipline: "road", subDiscipline: null };
}

/**
 * Ensure slug is unique by appending a number if needed
 * Returns a function that can check and modify the slug
 */
export function makeSlugUnique(
  baseSlug: string,
  existingSlugs: Set<string>
): string {
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  let newSlug = `${baseSlug}-${counter}`;
  while (existingSlugs.has(newSlug)) {
    counter++;
    newSlug = `${baseSlug}-${counter}`;
  }

  return newSlug;
}
