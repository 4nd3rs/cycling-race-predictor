/**
 * Race Profile Affinity Module
 *
 * Calculates how well a rider's historical performance matches
 * different race profiles (flat, hilly, mountain, TT, cobbles).
 */

// ============================================================================
// TYPES
// ============================================================================

export type ProfileType = "flat" | "hilly" | "mountain" | "tt" | "cobbles";

export interface ProfileResult {
  profileType: ProfileType;
  position: number | null;
  fieldSize: number;
  raceWeight: number;
  dnf: boolean;
}

export interface ProfileAffinities {
  flat: number;
  hilly: number;
  mountain: number;
  tt: number;
  cobbles: number;
}

export interface ProfileAnalysis {
  affinities: ProfileAffinities;
  specialty: ProfileType[];
  weakness: ProfileType[];
  sampleSizes: Record<ProfileType, number>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Minimum races needed to have confidence in affinity
const MIN_RACES_FOR_CONFIDENCE = 3;

// Default affinity (used when no data available)
const DEFAULT_AFFINITY = 0.5;

// Affinity thresholds
const SPECIALTY_THRESHOLD = 0.7;
const WEAKNESS_THRESHOLD = 0.3;

// ============================================================================
// PROFILE AFFINITY CALCULATION
// ============================================================================

/**
 * Calculate performance score from a single race result
 * Returns 0-1 value
 */
function calculatePerformanceScore(
  position: number | null,
  fieldSize: number,
  dnf: boolean
): number {
  if (dnf || position === null) {
    return 0.1; // DNF gives small credit for at least starting
  }

  // Top positions get bonus
  if (position === 1) return 1.0;
  if (position === 2) return 0.95;
  if (position === 3) return 0.9;
  if (position <= 5) return 0.85;
  if (position <= 10) return 0.75;
  if (position <= 20) return 0.6;

  // Linear scale for remaining positions
  const normalized = Math.max(0, 1 - (position - 1) / (fieldSize - 1 || 1));
  return 0.1 + normalized * 0.4; // Map to 0.1-0.5 range
}

/**
 * Calculate profile affinities from historical results
 */
export function calculateProfileAffinities(
  results: ProfileResult[]
): ProfileAnalysis {
  const profileData: Record<
    ProfileType,
    { totalWeight: number; weightedScore: number; count: number }
  > = {
    flat: { totalWeight: 0, weightedScore: 0, count: 0 },
    hilly: { totalWeight: 0, weightedScore: 0, count: 0 },
    mountain: { totalWeight: 0, weightedScore: 0, count: 0 },
    tt: { totalWeight: 0, weightedScore: 0, count: 0 },
    cobbles: { totalWeight: 0, weightedScore: 0, count: 0 },
  };

  // Aggregate results by profile
  for (const result of results) {
    const profile = result.profileType as ProfileType;
    if (!profileData[profile]) continue;

    const score = calculatePerformanceScore(
      result.position,
      result.fieldSize,
      result.dnf
    );
    const weight = result.raceWeight;

    profileData[profile].totalWeight += weight;
    profileData[profile].weightedScore += score * weight;
    profileData[profile].count++;
  }

  // Calculate affinities
  const affinities: ProfileAffinities = {
    flat: DEFAULT_AFFINITY,
    hilly: DEFAULT_AFFINITY,
    mountain: DEFAULT_AFFINITY,
    tt: DEFAULT_AFFINITY,
    cobbles: DEFAULT_AFFINITY,
  };

  const sampleSizes: Record<ProfileType, number> = {
    flat: 0,
    hilly: 0,
    mountain: 0,
    tt: 0,
    cobbles: 0,
  };

  for (const [profile, data] of Object.entries(profileData) as Array<
    [ProfileType, typeof profileData.flat]
  >) {
    sampleSizes[profile] = data.count;

    if (data.count >= MIN_RACES_FOR_CONFIDENCE && data.totalWeight > 0) {
      affinities[profile] = data.weightedScore / data.totalWeight;
    } else if (data.count > 0 && data.totalWeight > 0) {
      // Partial confidence: blend with default
      const confidence = data.count / MIN_RACES_FOR_CONFIDENCE;
      const calculated = data.weightedScore / data.totalWeight;
      affinities[profile] =
        calculated * confidence + DEFAULT_AFFINITY * (1 - confidence);
    }
  }

  // Identify specialties and weaknesses
  const specialty: ProfileType[] = [];
  const weakness: ProfileType[] = [];

  for (const [profile, affinity] of Object.entries(affinities) as Array<
    [ProfileType, number]
  >) {
    if (sampleSizes[profile] >= MIN_RACES_FOR_CONFIDENCE) {
      if (affinity >= SPECIALTY_THRESHOLD) {
        specialty.push(profile);
      } else if (affinity <= WEAKNESS_THRESHOLD) {
        weakness.push(profile);
      }
    }
  }

  // Sort specialties by affinity (highest first)
  specialty.sort((a, b) => affinities[b] - affinities[a]);
  weakness.sort((a, b) => affinities[a] - affinities[b]);

  return {
    affinities,
    specialty,
    weakness,
    sampleSizes,
  };
}

/**
 * Calculate profile affinity multiplier for prediction
 * Returns 0.7 to 1.3 based on how well rider matches race profile
 */
export function profileAffinityMultiplier(
  affinity: number,
  sampleSize: number
): number {
  // Reduce impact if sample size is small
  const confidence = Math.min(1, sampleSize / MIN_RACES_FOR_CONFIDENCE);

  // Map affinity (0-1) to multiplier (0.7-1.3)
  const baseMultiplier = 0.7 + affinity * 0.6;

  // Blend with 1.0 based on confidence
  return baseMultiplier * confidence + 1.0 * (1 - confidence);
}

/**
 * Classify a race's profile based on distance and elevation
 */
export function classifyRaceProfile(
  distanceKm: number | null,
  elevationM: number | null,
  isTimeTrial: boolean = false
): ProfileType {
  if (isTimeTrial) return "tt";

  if (!distanceKm || !elevationM) {
    return "hilly"; // Default if no data
  }

  // Calculate meters of climbing per km
  const elevationPerKm = elevationM / distanceKm;

  // Classification thresholds (based on typical race profiles)
  if (elevationPerKm < 10) return "flat";
  if (elevationPerKm < 20) return "hilly";
  return "mountain";
}

/**
 * Get profile display name
 */
export function getProfileDisplayName(profile: ProfileType): string {
  const names: Record<ProfileType, string> = {
    flat: "Flat",
    hilly: "Hilly",
    mountain: "Mountain",
    tt: "Time Trial",
    cobbles: "Cobbles",
  };
  return names[profile] || profile;
}

/**
 * Get profile icon/emoji
 */
export function getProfileIcon(profile: ProfileType): string {
  const icons: Record<ProfileType, string> = {
    flat: "➖",
    hilly: "〰️",
    mountain: "⛰️",
    tt: "⏱️",
    cobbles: "🪨",
  };
  return icons[profile] || "🚴";
}

/**
 * Describe a rider's profile strengths
 */
export function describeProfileStrengths(analysis: ProfileAnalysis): string {
  if (analysis.specialty.length === 0) {
    return "All-rounder with no clear specialty";
  }

  const specialtyNames = analysis.specialty.map(getProfileDisplayName);

  if (specialtyNames.length === 1) {
    return `${specialtyNames[0]} specialist`;
  }

  const last = specialtyNames.pop();
  return `${specialtyNames.join(", ")} and ${last} specialist`;
}
