/**
 * TrueSkill-inspired ELO System for Cycling
 *
 * Based on Microsoft's TrueSkill algorithm with adaptations for cycling:
 * - Skill represented as normal distribution (mean + variance)
 * - Rating = mean - 3*variance (99% confidence floor)
 * - Handles large races by sampling 30-rider subgroups
 *
 * References:
 * - https://mortirolo.netlify.app/post/elo-rating-method/
 * - https://www.microsoft.com/en-us/research/publication/trueskill-2-an-improved-bayesian-skill-rating-system/
 */

// ============================================================================
// CONSTANTS
// ============================================================================

// Initial skill parameters
const INITIAL_MEAN = 1500;
const INITIAL_VARIANCE = 350;

// System parameters
const BETA = INITIAL_VARIANCE / 2; // Performance variance (skill uncertainty during a race)
const TAU = INITIAL_VARIANCE / 100; // Dynamics factor (skill change over time)
const DRAW_PROBABILITY = 0; // Cycling has no draws

// Sampling parameters for large races
const SUBGROUP_SIZE = 30;
const NUM_SAMPLES = 100;

// ============================================================================
// TYPES
// ============================================================================

export interface RiderSkill {
  riderId: string;
  mean: number; // μ - estimated skill level
  variance: number; // σ - uncertainty in skill estimate
}

export interface RaceResult {
  riderId: string;
  position: number; // 1-based finish position
  dnf?: boolean;
}

export interface SkillUpdate {
  riderId: string;
  oldMean: number;
  oldVariance: number;
  newMean: number;
  newVariance: number;
  eloChange: number;
}

// ============================================================================
// MATH UTILITIES
// ============================================================================

/**
 * Standard normal CDF (cumulative distribution function)
 */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal PDF (probability density function)
 */
function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * V function for TrueSkill update
 * Truncated Gaussian correction for winner
 */
function vFunction(t: number, epsilon: number): number {
  const denom = normalCdf(t - epsilon);
  if (denom < 1e-10) return -t + epsilon;
  return normalPdf(t - epsilon) / denom;
}

/**
 * W function for TrueSkill update
 * Variance correction for winner
 */
function wFunction(t: number, epsilon: number): number {
  const v = vFunction(t, epsilon);
  return v * (v + t - epsilon);
}

// ============================================================================
// CORE TRUESKILL FUNCTIONS
// ============================================================================

/**
 * Calculate the ELO rating from mean and variance
 * Uses the "conservative" estimate: μ - 3σ
 */
export function calculateElo(mean: number, variance: number): number {
  return mean - 3 * Math.sqrt(variance);
}

/**
 * Create initial skill for a new rider
 */
export function createInitialSkill(riderId: string): RiderSkill {
  return {
    riderId,
    mean: INITIAL_MEAN,
    variance: INITIAL_VARIANCE * INITIAL_VARIANCE, // Store variance, not standard deviation
  };
}

/**
 * Update skills for a pairwise comparison (rider A beats rider B)
 */
function updatePairwise(
  winnerSkill: RiderSkill,
  loserSkill: RiderSkill
): { winner: RiderSkill; loser: RiderSkill } {
  const c = Math.sqrt(
    2 * BETA * BETA +
      winnerSkill.variance +
      loserSkill.variance
  );

  const t = (winnerSkill.mean - loserSkill.mean) / c;
  const epsilon = DRAW_PROBABILITY / c;

  const v = vFunction(t, epsilon);
  const w = wFunction(t, epsilon);

  // Update winner
  const winnerMeanMultiplier = winnerSkill.variance / c;
  const winnerVarianceMultiplier = winnerSkill.variance / (c * c);

  const newWinnerMean = winnerSkill.mean + winnerMeanMultiplier * v;
  const newWinnerVariance = winnerSkill.variance * (1 - w * winnerVarianceMultiplier);

  // Update loser
  const loserMeanMultiplier = loserSkill.variance / c;
  const loserVarianceMultiplier = loserSkill.variance / (c * c);

  const newLoserMean = loserSkill.mean - loserMeanMultiplier * v;
  const newLoserVariance = loserSkill.variance * (1 - w * loserVarianceMultiplier);

  return {
    winner: {
      riderId: winnerSkill.riderId,
      mean: newWinnerMean,
      variance: Math.max(newWinnerVariance, TAU * TAU), // Floor variance
    },
    loser: {
      riderId: loserSkill.riderId,
      mean: newLoserMean,
      variance: Math.max(newLoserVariance, TAU * TAU),
    },
  };
}

/**
 * Apply dynamics factor (increase variance over time)
 * Call this when a rider hasn't raced recently
 */
export function applyDynamics(skill: RiderSkill, daysSinceRace: number): RiderSkill {
  // Increase variance based on time since last race
  const varianceIncrease = TAU * TAU * Math.min(daysSinceRace / 30, 5);
  return {
    ...skill,
    variance: Math.min(
      skill.variance + varianceIncrease,
      INITIAL_VARIANCE * INITIAL_VARIANCE
    ),
  };
}

// ============================================================================
// RACE PROCESSING
// ============================================================================

/**
 * Sample random subgroups for processing large races
 * This is the key optimization from the Mortirolo approach
 */
function sampleSubgroups(
  results: RaceResult[],
  subgroupSize: number,
  numSamples: number
): RaceResult[][] {
  const subgroups: RaceResult[][] = [];

  for (let i = 0; i < numSamples; i++) {
    // Randomly sample riders
    const shuffled = [...results].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, Math.min(subgroupSize, shuffled.length));

    // Sort by original position to maintain relative ordering
    sample.sort((a, b) => a.position - b.position);

    subgroups.push(sample);
  }

  return subgroups;
}

/**
 * Process a single subgroup using Bradley-Terry model
 * Each pairwise comparison contributes to skill updates
 */
function processSubgroup(
  subgroup: RaceResult[],
  skills: Map<string, RiderSkill>
): Map<string, { meanDelta: number; varianceDelta: number; count: number }> {
  const deltas = new Map<
    string,
    { meanDelta: number; varianceDelta: number; count: number }
  >();

  // Initialize deltas for all riders in subgroup
  for (const result of subgroup) {
    if (!deltas.has(result.riderId)) {
      deltas.set(result.riderId, { meanDelta: 0, varianceDelta: 0, count: 0 });
    }
  }

  // Process all pairwise comparisons
  for (let i = 0; i < subgroup.length; i++) {
    for (let j = i + 1; j < subgroup.length; j++) {
      const winner = subgroup[i]; // Higher position (lower number)
      const loser = subgroup[j]; // Lower position (higher number)

      const winnerSkill = skills.get(winner.riderId);
      const loserSkill = skills.get(loser.riderId);

      if (!winnerSkill || !loserSkill) continue;

      const { winner: newWinner, loser: newLoser } = updatePairwise(
        winnerSkill,
        loserSkill
      );

      // Accumulate deltas
      const winnerDelta = deltas.get(winner.riderId)!;
      winnerDelta.meanDelta += newWinner.mean - winnerSkill.mean;
      winnerDelta.varianceDelta += newWinner.variance - winnerSkill.variance;
      winnerDelta.count++;

      const loserDelta = deltas.get(loser.riderId)!;
      loserDelta.meanDelta += newLoser.mean - loserSkill.mean;
      loserDelta.varianceDelta += newLoser.variance - loserSkill.variance;
      loserDelta.count++;
    }
  }

  return deltas;
}

/**
 * Process an entire race and update skills
 *
 * For races with ≤30 riders: process all pairwise comparisons
 * For larger races: sample subgroups (100 samples of 30 riders each)
 */
export function processRace(
  results: RaceResult[],
  skills: Map<string, RiderSkill>
): SkillUpdate[] {
  // Filter out DNF riders (they don't contribute to rankings)
  const finishers = results.filter((r) => !r.dnf && r.position > 0);

  if (finishers.length < 2) {
    return []; // Need at least 2 finishers
  }

  // Ensure all riders have skills
  for (const result of finishers) {
    if (!skills.has(result.riderId)) {
      skills.set(result.riderId, createInitialSkill(result.riderId));
    }
  }

  // Accumulate deltas across all samples/comparisons
  const totalDeltas = new Map<
    string,
    { meanDelta: number; varianceDelta: number; count: number }
  >();

  for (const result of finishers) {
    totalDeltas.set(result.riderId, { meanDelta: 0, varianceDelta: 0, count: 0 });
  }

  if (finishers.length <= SUBGROUP_SIZE) {
    // Small race: process all pairwise comparisons directly
    const deltas = processSubgroup(finishers, skills);
    for (const [riderId, delta] of deltas) {
      const total = totalDeltas.get(riderId)!;
      total.meanDelta += delta.meanDelta;
      total.varianceDelta += delta.varianceDelta;
      total.count += delta.count;
    }
  } else {
    // Large race: sample subgroups
    const subgroups = sampleSubgroups(finishers, SUBGROUP_SIZE, NUM_SAMPLES);

    for (const subgroup of subgroups) {
      const deltas = processSubgroup(subgroup, skills);
      for (const [riderId, delta] of deltas) {
        const total = totalDeltas.get(riderId);
        if (total) {
          total.meanDelta += delta.meanDelta;
          total.varianceDelta += delta.varianceDelta;
          total.count += delta.count;
        }
      }
    }
  }

  // Apply averaged deltas and generate updates
  const updates: SkillUpdate[] = [];

  for (const [riderId, delta] of totalDeltas) {
    if (delta.count === 0) continue;

    const oldSkill = skills.get(riderId)!;
    const avgMeanDelta = delta.meanDelta / delta.count;
    const avgVarianceDelta = delta.varianceDelta / delta.count;

    const newSkill: RiderSkill = {
      riderId,
      mean: oldSkill.mean + avgMeanDelta,
      variance: Math.max(
        oldSkill.variance + avgVarianceDelta,
        TAU * TAU
      ),
    };

    // Update the skills map
    skills.set(riderId, newSkill);

    const oldElo = calculateElo(oldSkill.mean, oldSkill.variance);
    const newElo = calculateElo(newSkill.mean, newSkill.variance);

    updates.push({
      riderId,
      oldMean: oldSkill.mean,
      oldVariance: oldSkill.variance,
      newMean: newSkill.mean,
      newVariance: newSkill.variance,
      eloChange: newElo - oldElo,
    });
  }

  return updates;
}

// ============================================================================
// PREDICTION UTILITIES
// ============================================================================

/**
 * Calculate the probability that rider A beats rider B
 */
export function winProbability(
  riderA: RiderSkill,
  riderB: RiderSkill
): number {
  const c = Math.sqrt(
    2 * BETA * BETA + riderA.variance + riderB.variance
  );
  const t = (riderA.mean - riderB.mean) / c;
  return normalCdf(t);
}

/**
 * Calculate all probabilities (win, podium, top10) for all riders in a single simulation batch
 * This is much more efficient than calculating each probability separately
 */
export function calculateAllProbabilities(
  skills: Map<string, RiderSkill>
): Map<string, { win: number; podium: number; top10: number }> {
  const riderIds = Array.from(skills.keys());
  const results = new Map<string, { win: number; podium: number; top10: number }>();

  // Initialize counters
  const wins = new Map<string, number>();
  const podiums = new Map<string, number>();
  const top10s = new Map<string, number>();

  for (const riderId of riderIds) {
    wins.set(riderId, 0);
    podiums.set(riderId, 0);
    top10s.set(riderId, 0);
  }

  // Single batch of simulations - reduced from 10000 to 1000 for speed
  const numSimulations = 1000;
  const skillsArray = Array.from(skills.entries());

  for (let sim = 0; sim < numSimulations; sim++) {
    // Generate random performance for each rider
    const performances: Array<{ riderId: string; performance: number }> = [];

    for (const [riderId, skill] of skillsArray) {
      const performance =
        skill.mean + Math.sqrt(skill.variance + BETA * BETA) * gaussianRandom();
      performances.push({ riderId, performance });
    }

    // Sort by performance (highest first)
    performances.sort((a, b) => b.performance - a.performance);

    // Count positions for each rider
    for (let i = 0; i < performances.length; i++) {
      const riderId = performances[i].riderId;
      if (i === 0) wins.set(riderId, (wins.get(riderId) || 0) + 1);
      if (i < 3) podiums.set(riderId, (podiums.get(riderId) || 0) + 1);
      if (i < 10) top10s.set(riderId, (top10s.get(riderId) || 0) + 1);
    }
  }

  // Convert counts to probabilities
  for (const riderId of riderIds) {
    results.set(riderId, {
      win: (wins.get(riderId) || 0) / numSimulations,
      podium: (podiums.get(riderId) || 0) / numSimulations,
      top10: (top10s.get(riderId) || 0) / numSimulations,
    });
  }

  return results;
}

/**
 * Calculate win probabilities for all riders against each other
 * Returns estimated win probability for each rider
 * @deprecated Use calculateAllProbabilities instead for better performance
 */
export function calculateWinProbabilities(
  skills: Map<string, RiderSkill>
): Map<string, number> {
  const allProbs = calculateAllProbabilities(skills);
  const winProbs = new Map<string, number>();
  for (const [riderId, probs] of allProbs) {
    winProbs.set(riderId, probs.win);
  }
  return winProbs;
}

/**
 * Generate a random number from standard normal distribution
 * Using Box-Muller transform
 */
function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Calculate expected position for a rider in a race
 */
export function expectedPosition(
  riderSkill: RiderSkill,
  allSkills: Map<string, RiderSkill>
): number {
  let betterRiders = 0;

  for (const [otherId, otherSkill] of allSkills) {
    if (otherId === riderSkill.riderId) continue;

    // Probability that other rider beats this rider
    const otherWinsProb = winProbability(otherSkill, riderSkill);
    betterRiders += otherWinsProb;
  }

  // Expected position is 1 + number of riders expected to beat this one
  return 1 + betterRiders;
}

/**
 * Calculate podium probability (top 3) for a rider
 */
export function podiumProbability(
  riderSkill: RiderSkill,
  allSkills: Map<string, RiderSkill>
): number {
  const numSimulations = 5000;
  let podiumCount = 0;

  const skillsArray = Array.from(allSkills.entries());

  for (let sim = 0; sim < numSimulations; sim++) {
    const performances: Array<{ riderId: string; performance: number }> = [];

    for (const [riderId, skill] of skillsArray) {
      const performance =
        skill.mean + Math.sqrt(skill.variance + BETA * BETA) * gaussianRandom();
      performances.push({ riderId, performance });
    }

    performances.sort((a, b) => b.performance - a.performance);

    // Check if our rider is in top 3
    const riderPosition = performances.findIndex(
      (p) => p.riderId === riderSkill.riderId
    );
    if (riderPosition < 3) {
      podiumCount++;
    }
  }

  return podiumCount / numSimulations;
}

/**
 * Calculate top-10 probability for a rider
 */
export function top10Probability(
  riderSkill: RiderSkill,
  allSkills: Map<string, RiderSkill>
): number {
  const numSimulations = 5000;
  let top10Count = 0;

  const skillsArray = Array.from(allSkills.entries());

  for (let sim = 0; sim < numSimulations; sim++) {
    const performances: Array<{ riderId: string; performance: number }> = [];

    for (const [riderId, skill] of skillsArray) {
      const performance =
        skill.mean + Math.sqrt(skill.variance + BETA * BETA) * gaussianRandom();
      performances.push({ riderId, performance });
    }

    performances.sort((a, b) => b.performance - a.performance);

    const riderPosition = performances.findIndex(
      (p) => p.riderId === riderSkill.riderId
    );
    if (riderPosition < 10) {
      top10Count++;
    }
  }

  return top10Count / numSimulations;
}
