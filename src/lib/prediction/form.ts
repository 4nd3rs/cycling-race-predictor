/**
 * Form Calculation Module
 *
 * Calculates a rider's recent form based on their performance
 * over the last 90 days, with exponential time decay.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RecentResult {
  date: Date;
  position: number | null;
  fieldSize: number;
  raceWeight: number; // UCI category weight (e.g., WorldTour = 1.0, Pro = 0.8)
  profileType: string; // 'flat' | 'hilly' | 'mountain' | 'tt'
  dnf: boolean;
}

export interface FormScore {
  overall: number; // -1 to 1 (negative = bad form, positive = good form)
  byProfile: Record<string, number>; // Form score per profile type
  racesCount: number;
  lastRaceDate: Date | null;
  trend: "improving" | "stable" | "declining";
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Time decay half-life in days
const HALF_LIFE_DAYS = 21;

// Maximum days to consider for form
const MAX_DAYS = 90;

// Weight multipliers for UCI race categories
export const RACE_CATEGORY_WEIGHTS: Record<string, number> = {
  "WorldTour": 1.0,
  "2.UWT": 1.0,
  "1.UWT": 1.0,
  "2.Pro": 0.85,
  "1.Pro": 0.85,
  "2.1": 0.7,
  "1.1": 0.7,
  "2.2": 0.5,
  "1.2": 0.5,
  "National Championship": 0.6,
  "Grand Tour": 1.0,
  "Monument": 1.0,
  "default": 0.5,
};

// ============================================================================
// FORM CALCULATION
// ============================================================================

/**
 * Calculate time decay weight
 * Uses exponential decay: weight = 0.5^(days/halfLife)
 */
function calculateTimeDecay(daysSinceRace: number): number {
  return Math.pow(0.5, daysSinceRace / HALF_LIFE_DAYS);
}

/**
 * Calculate performance score from race result
 * Returns a value from -1 (DNF/last place) to 1 (win)
 */
function calculatePerformanceScore(
  position: number | null,
  fieldSize: number,
  dnf: boolean
): number {
  if (dnf || position === null) {
    return -0.5; // DNF is bad but not as bad as finishing last
  }

  // Normalize position: 1st = 1.0, last = 0.0
  const normalizedPosition = 1 - (position - 1) / (fieldSize - 1 || 1);

  // Transform to -1 to 1 range, with bonus for top positions
  if (position === 1) return 1.0;
  if (position === 2) return 0.8;
  if (position === 3) return 0.65;
  if (position <= 5) return 0.5;
  if (position <= 10) return 0.35;
  if (position <= 20) return 0.2;

  // For positions below top 20, use linear scale
  return Math.max(-1, normalizedPosition * 2 - 1);
}

/**
 * Calculate form score from recent results
 */
export function calculateForm(
  results: RecentResult[],
  referenceDate: Date = new Date()
): FormScore {
  if (results.length === 0) {
    return {
      overall: 0,
      byProfile: {},
      racesCount: 0,
      lastRaceDate: null,
      trend: "stable",
    };
  }

  // Filter results within the time window
  const relevantResults = results.filter((result) => {
    const daysSince = (referenceDate.getTime() - result.date.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= MAX_DAYS && daysSince >= 0;
  });

  if (relevantResults.length === 0) {
    return {
      overall: 0,
      byProfile: {},
      racesCount: 0,
      lastRaceDate: results[0]?.date || null,
      trend: "stable",
    };
  }

  // Sort by date (most recent first)
  relevantResults.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Calculate weighted scores
  let totalWeight = 0;
  let weightedScore = 0;
  const profileScores: Record<string, { weight: number; score: number }> = {};

  for (const result of relevantResults) {
    const daysSince =
      (referenceDate.getTime() - result.date.getTime()) / (1000 * 60 * 60 * 24);
    const timeDecay = calculateTimeDecay(daysSince);
    const performanceScore = calculatePerformanceScore(
      result.position,
      result.fieldSize,
      result.dnf
    );

    const weight = timeDecay * result.raceWeight;
    totalWeight += weight;
    weightedScore += performanceScore * weight;

    // Track by profile
    if (!profileScores[result.profileType]) {
      profileScores[result.profileType] = { weight: 0, score: 0 };
    }
    profileScores[result.profileType].weight += weight;
    profileScores[result.profileType].score += performanceScore * weight;
  }

  // Calculate overall form
  const overall = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Calculate form by profile
  const byProfile: Record<string, number> = {};
  for (const [profile, data] of Object.entries(profileScores)) {
    byProfile[profile] = data.weight > 0 ? data.score / data.weight : 0;
  }

  // Calculate trend (compare first half to second half of results)
  const midpoint = Math.floor(relevantResults.length / 2);
  const recentResults = relevantResults.slice(0, midpoint || 1);
  const olderResults = relevantResults.slice(midpoint || 1);

  const recentAvg =
    recentResults.reduce(
      (sum, r) =>
        sum + calculatePerformanceScore(r.position, r.fieldSize, r.dnf),
      0
    ) / (recentResults.length || 1);

  const olderAvg =
    olderResults.reduce(
      (sum, r) =>
        sum + calculatePerformanceScore(r.position, r.fieldSize, r.dnf),
      0
    ) / (olderResults.length || 1);

  let trend: "improving" | "stable" | "declining" = "stable";
  const trendDiff = recentAvg - olderAvg;
  if (trendDiff > 0.15) trend = "improving";
  else if (trendDiff < -0.15) trend = "declining";

  return {
    overall,
    byProfile,
    racesCount: relevantResults.length,
    lastRaceDate: relevantResults[0].date,
    trend,
  };
}

/**
 * Calculate form factor for prediction
 * Returns a multiplier (0.8 to 1.2) based on form
 */
export function formMultiplier(formScore: number): number {
  // Clamp form score to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, formScore));

  // Map to 0.8-1.2 range
  return 1 + clamped * 0.2;
}

/**
 * Calculate days since last race
 */
export function daysSinceLastRace(
  lastRaceDate: Date | null,
  referenceDate: Date = new Date()
): number {
  if (!lastRaceDate) return Infinity;
  return Math.floor(
    (referenceDate.getTime() - lastRaceDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Get a human-readable form description
 */
export function describeForm(formScore: FormScore): string {
  const { overall, trend, racesCount, lastRaceDate } = formScore;

  if (racesCount === 0) {
    return "No recent race data";
  }

  let description = "";

  // Overall form description
  if (overall >= 0.6) description = "Excellent form";
  else if (overall >= 0.3) description = "Good form";
  else if (overall >= 0) description = "Average form";
  else if (overall >= -0.3) description = "Below average form";
  else description = "Poor form";

  // Add trend
  if (trend === "improving") description += " (improving)";
  else if (trend === "declining") description += " (declining)";

  // Add last race info
  if (lastRaceDate) {
    const days = daysSinceLastRace(lastRaceDate);
    if (days <= 7) description += ` - raced ${days}d ago`;
    else if (days <= 30) description += ` - last race ${Math.round(days / 7)}w ago`;
    else description += ` - hasn't raced in ${Math.round(days / 30)}+ months`;
  }

  return description;
}
