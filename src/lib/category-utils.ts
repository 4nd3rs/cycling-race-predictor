/**
 * Category utility functions for MTB races
 * Can be used in both server and client components
 */

/**
 * Format category for display
 */
export function formatCategoryDisplay(ageCategory: string, gender: string): string {
  const genderLabel = gender === "men" ? "Men" : "Women";
  const ageLabel =
    ageCategory === "elite"
      ? "Elite"
      : ageCategory === "u23"
      ? "U23"
      : ageCategory === "junior"
      ? "Junior"
      : ageCategory;
  return `${ageLabel} ${genderLabel}`;
}

/**
 * Get the badge variant for a category
 */
export function getCategoryBadgeVariant(
  ageCategory: string,
  gender: string
): "default" | "secondary" | "outline" {
  if (ageCategory === "elite") return "default";
  if (ageCategory === "u23") return "secondary";
  return "outline";
}
