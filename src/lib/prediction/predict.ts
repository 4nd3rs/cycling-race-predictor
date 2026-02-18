/**
 * Main Prediction Engine
 *
 * Combines ELO ratings, form calculation, profile affinity, and rumour modifiers
 * to generate race predictions.
 *
 * Formula:
 * FINAL SCORE = ELO_base * profile_affinity * form_factor * (1 + rumour_modifier * 0.05)
 */

import {
  type RiderSkill,
  calculateElo,
  calculateAllProbabilities,
  createInitialSkill,
} from "./trueskill";
import { type FormScore, formMultiplier } from "./form";
import { type ProfileType, profileAffinityMultiplier } from "./profile";

// ============================================================================
// TYPES
// ============================================================================

export interface RiderPredictionInput {
  riderId: string;
  riderName: string;
  // ELO data
  eloMean: number;
  eloVariance: number;
  // Form data
  formScore: FormScore;
  // Profile data
  profileAffinity: number;
  profileSampleSize: number;
  // Rumour data
  rumourScore: number; // -1 to 1
  rumourTipCount: number;
  // Team strength (future enhancement)
  teamStrength?: number;
}

export interface RacePrediction {
  riderId: string;
  riderName: string;
  // Probabilities (0-1)
  winProbability: number;
  podiumProbability: number;
  top10Probability: number;
  // Scores
  finalScore: number;
  eloScore: number;
  formMultiplier: number;
  profileMultiplier: number;
  rumourModifier: number;
  // Meta
  predictedPosition: number;
  confidence: number;
  reasoning: string;
}

export interface RacePredictionResult {
  raceId: string;
  predictions: RacePrediction[];
  generatedAt: Date;
  version: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Maximum rumour impact on final score (5%)
const MAX_RUMOUR_IMPACT = 0.05;

// Note: MIN_CONFIDENCE_THRESHOLD can be used in future to filter low-confidence predictions

// ============================================================================
// PREDICTION CALCULATION
// ============================================================================

/**
 * Calculate final score for a rider
 */
function calculateFinalScore(input: RiderPredictionInput): {
  finalScore: number;
  eloScore: number;
  formMult: number;
  profileMult: number;
  rumourMod: number;
} {
  // Use conservative estimate (μ-3σ) as the base score, floored at 1 to prevent
  // multiplication issues in finalScore. Unknown riders with high variance get low scores.
  const eloScore = Math.max(calculateElo(input.eloMean, input.eloVariance), 1);

  // Form multiplier (0.8 to 1.2)
  const formMult = formMultiplier(input.formScore.overall);

  // Profile affinity multiplier (0.7 to 1.3)
  const profileMult = profileAffinityMultiplier(
    input.profileAffinity,
    input.profileSampleSize
  );

  // Rumour modifier (capped at ±5%)
  // Only apply if there are multiple tips for corroboration
  const rumourWeight = Math.min(input.rumourTipCount / 3, 1); // Scale up to 3 tips
  const rumourMod = input.rumourScore * MAX_RUMOUR_IMPACT * rumourWeight;

  // Final score calculation
  const finalScore = eloScore * formMult * profileMult * (1 + rumourMod);

  return {
    finalScore,
    eloScore,
    formMult,
    profileMult,
    rumourMod,
  };
}

/**
 * Generate reasoning text for a prediction
 */
function generateReasoning(
  input: RiderPredictionInput,
  scores: {
    formMult: number;
    profileMult: number;
    rumourMod: number;
  },
  winProb: number
): string {
  const reasons: string[] = [];

  // Form-based reasoning
  if (scores.formMult >= 1.1) {
    reasons.push("excellent recent form");
  } else if (scores.formMult >= 1.05) {
    reasons.push("good recent form");
  } else if (scores.formMult <= 0.9) {
    reasons.push("poor recent form");
  } else if (scores.formMult <= 0.95) {
    reasons.push("below average recent form");
  }

  // Form trend
  if (input.formScore.trend === "improving") {
    reasons.push("form trending upward");
  } else if (input.formScore.trend === "declining") {
    reasons.push("form trending down");
  }

  // Profile-based reasoning
  if (scores.profileMult >= 1.2) {
    reasons.push("strong profile match");
  } else if (scores.profileMult >= 1.1) {
    reasons.push("good profile match");
  } else if (scores.profileMult <= 0.85) {
    reasons.push("weak profile match");
  }

  // Rumour-based reasoning
  if (scores.rumourMod > 0.02 && input.rumourTipCount >= 2) {
    reasons.push("positive community intel");
  } else if (scores.rumourMod < -0.02 && input.rumourTipCount >= 2) {
    reasons.push("concerning community reports");
  }

  // Win probability context
  if (winProb >= 0.2) {
    reasons.push("race favorite");
  } else if (winProb >= 0.1) {
    reasons.push("strong contender");
  }

  if (reasons.length === 0) {
    return "Steady performer with average expectations for this race.";
  }

  // Capitalize first letter and join
  const text = reasons.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

/**
 * Calculate confidence score based on data quality
 */
function calculateConfidence(input: RiderPredictionInput): number {
  let confidence = 0.5; // Base confidence

  // Adjust based on form data quality
  if (input.formScore.racesCount >= 5) {
    confidence += 0.15;
  } else if (input.formScore.racesCount >= 3) {
    confidence += 0.1;
  } else if (input.formScore.racesCount === 0) {
    confidence -= 0.2;
  }

  // Adjust based on profile data quality
  if (input.profileSampleSize >= 10) {
    confidence += 0.15;
  } else if (input.profileSampleSize >= 5) {
    confidence += 0.1;
  } else if (input.profileSampleSize === 0) {
    confidence -= 0.15;
  }

  // Adjust based on ELO variance (lower = more certain)
  const eloStdDev = Math.sqrt(input.eloVariance);
  if (eloStdDev < 100) {
    confidence += 0.1;
  } else if (eloStdDev > 250) {
    confidence -= 0.1;
  }

  // Adjust based on rumour corroboration
  if (input.rumourTipCount >= 3) {
    confidence += 0.05;
  }

  return Math.max(0.1, Math.min(0.95, confidence));
}

/**
 * Generate predictions for a race
 */
export function generateRacePredictions(
  raceId: string,
  startlist: RiderPredictionInput[],
  raceProfile: ProfileType
): RacePredictionResult {
  // raceProfile reserved for future profile-specific adjustments
  void raceProfile;

  if (startlist.length === 0) {
    return {
      raceId,
      predictions: [],
      generatedAt: new Date(),
      version: 1,
    };
  }

  // Calculate final scores for all riders
  const scoredRiders = startlist.map((input) => {
    const scores = calculateFinalScore(input);
    return {
      input,
      ...scores,
    };
  });

  // Build skills map for probability calculations
  const skillsMap = new Map<string, RiderSkill>();
  for (const scored of scoredRiders) {
    skillsMap.set(scored.input.riderId, {
      riderId: scored.input.riderId,
      mean: scored.input.eloMean,
      variance: scored.input.eloVariance,
    });
  }

  // Calculate all probabilities in a single efficient batch
  const allProbs = calculateAllProbabilities(skillsMap);

  // Build predictions using pre-calculated probabilities
  const predictions: RacePrediction[] = scoredRiders.map((scored) => {
    const probs = allProbs.get(scored.input.riderId) || { win: 0, podium: 0, top10: 0 };

    const confidence = calculateConfidence(scored.input);
    const reasoning = generateReasoning(
      scored.input,
      {
        formMult: scored.formMult,
        profileMult: scored.profileMult,
        rumourMod: scored.rumourMod,
      },
      probs.win
    );

    return {
      riderId: scored.input.riderId,
      riderName: scored.input.riderName,
      winProbability: probs.win,
      podiumProbability: probs.podium,
      top10Probability: probs.top10,
      finalScore: scored.finalScore,
      eloScore: scored.eloScore,
      formMultiplier: scored.formMult,
      profileMultiplier: scored.profileMult,
      rumourModifier: scored.rumourMod,
      predictedPosition: 0, // Will be set after sorting
      confidence,
      reasoning,
    };
  });

  // Sort by final score (highest first) and assign predicted positions
  predictions.sort((a, b) => b.finalScore - a.finalScore);
  predictions.forEach((pred, index) => {
    pred.predictedPosition = index + 1;
  });

  return {
    raceId,
    predictions,
    generatedAt: new Date(),
    version: 1,
  };
}

/**
 * Get top N predictions for display
 */
export function getTopPredictions(
  result: RacePredictionResult,
  n: number = 10
): RacePrediction[] {
  return result.predictions.slice(0, n);
}

/**
 * Format probability for display
 */
export function formatProbability(prob: number): string {
  if (prob >= 0.01) {
    return `${(prob * 100).toFixed(1)}%`;
  }
  return "<1%";
}

/**
 * Get probability tier for styling
 */
export function getProbabilityTier(
  prob: number
): "high" | "medium" | "low" | "minimal" {
  if (prob >= 0.15) return "high";
  if (prob >= 0.05) return "medium";
  if (prob >= 0.01) return "low";
  return "minimal";
}
