/**
 * Generate Predictions Agent
 *
 * Generates race predictions for all riders in a startlist.
 * Creates default riderDisciplineStats for riders who lack them,
 * then computes scores combining ELO and UCI points.
 *
 * Usage: node_modules/.bin/tsx scripts/agents/generate-predictions.ts --race-id <uuid>
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const raceIdIdx = args.indexOf("--race-id");
const raceId = raceIdIdx !== -1 ? args[raceIdIdx + 1] : null;

if (!raceId) {
  console.error("Usage: tsx scripts/agents/generate-predictions.ts --race-id <uuid>");
  process.exit(1);
}

// Softmax temperature
const SOFTMAX_T = 200;

function softmax(scores: number[], temperature: number): number[] {
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

async function main() {
  // 1. Load the race
  const race = await db.query.races.findFirst({
    where: eq(schema.races.id, raceId!),
  });

  if (!race) {
    console.error(`Race not found: ${raceId}`);
    process.exit(1);
  }

  const discipline = race.discipline;
  const ageCategory = race.ageCategory || "elite";
  const gender = race.gender || "men";

  console.log(`\nRace: ${race.name} (${race.date})`);
  console.log(`Discipline: ${discipline}, Category: ${ageCategory}, Gender: ${gender}\n`);

  // 2. Load all riders in the startlist
  const startlistEntries = await db.query.raceStartlist.findMany({
    where: eq(schema.raceStartlist.raceId, raceId!),
    with: { rider: true },
  });

  if (startlistEntries.length === 0) {
    console.log("No riders in startlist. Nothing to predict.");
    process.exit(0);
  }

  console.log(`Startlist: ${startlistEntries.length} riders`);

  // 3. For each rider, load or create discipline stats
  let initialized = 0;
  let withExisting = 0;

  interface RiderScore {
    riderId: string;
    riderName: string;
    eloMean: number;
    uciPoints: number;
    rumourModifier: number;
    score: number;
  }

  const riderScores: RiderScore[] = [];

  for (const entry of startlistEntries) {
    const rider = entry.rider;
    if (!rider) continue;

    // Find existing discipline stats
    let stats = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(schema.riderDisciplineStats.riderId, rider.id),
        eq(schema.riderDisciplineStats.discipline, discipline),
        eq(schema.riderDisciplineStats.ageCategory, ageCategory)
      ),
    });

    if (!stats) {
      // Create default stats
      await db
        .insert(schema.riderDisciplineStats)
        .values({
          riderId: rider.id,
          discipline,
          ageCategory,
          gender,
          currentElo: "1500",
          eloMean: "1500",
          eloVariance: "350",
          uciPoints: 0,
        })
        .onConflictDoNothing();

      stats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(schema.riderDisciplineStats.riderId, rider.id),
          eq(schema.riderDisciplineStats.discipline, discipline),
          eq(schema.riderDisciplineStats.ageCategory, ageCategory)
        ),
      });

      initialized++;
    } else {
      withExisting++;
    }

    const eloMean = stats ? parseFloat(stats.eloMean || "1500") : 1500;
    const uciPoints = stats?.uciPoints ?? 0;

    // Check for rumours
    const rumour = await db.query.riderRumours.findFirst({
      where: and(
        eq(schema.riderRumours.riderId, rider.id),
        eq(schema.riderRumours.raceId, raceId!)
      ),
    });

    // Also check rider-level rumours (no specific race)
    const generalRumour = rumour
      ? null
      : await db.query.riderRumours.findFirst({
          where: eq(schema.riderRumours.riderId, rider.id),
        });

    const rumourSentiment = rumour
      ? parseFloat(rumour.aggregateScore || "0")
      : generalRumour
        ? parseFloat(generalRumour.aggregateScore || "0")
        : 0;

    // rumourModifier: sentiment -1 to +1, apply as ±5%
    const rumourModifier = rumourSentiment * 0.05;

    // 5. Compute score
    const eloComponent = eloMean * 0.7;
    const uciComponent = Math.min(uciPoints / 2000 * 500, 500) * 0.3;
    const rawScore = eloComponent + uciComponent;
    const score = rawScore * (1 + rumourModifier);

    riderScores.push({
      riderId: rider.id,
      riderName: rider.name,
      eloMean,
      uciPoints,
      rumourModifier,
      score,
    });
  }

  console.log(`Stats: ${withExisting} existing, ${initialized} initialized with defaults`);

  // 6. Sort by score descending
  riderScores.sort((a, b) => b.score - a.score);

  // 7. Calculate probabilities using softmax
  const scores = riderScores.map((r) => r.score);
  const probs = softmax(scores, SOFTMAX_T);

  // Calculate podium and top10 probabilities
  // For each rider, sum of probabilities of being in position 1..3 and 1..10
  // Using softmax-derived positional probabilities as an approximation
  const podiumProbs: number[] = [];
  const top10Probs: number[] = [];

  for (let i = 0; i < riderScores.length; i++) {
    // Podium: sum of top-3 softmax probs for this rider's score level
    // Approximation: use cumulative softmax position probability
    let podiumP = 0;
    let top10P = 0;

    // Simple approach: win prob + proportion of remaining probability mass
    // A rider ranked K has win prob probs[K]. Podium ≈ sum of how often they'd land in top 3.
    // We use a simulation-like approach via softmax ranking.
    if (i < 3) {
      podiumP = Math.min(1.0, probs[i] * riderScores.length / 3);
    } else {
      podiumP = Math.min(0.99, probs[i] * riderScores.length / 3);
    }

    if (i < 10) {
      top10P = Math.min(1.0, probs[i] * riderScores.length / 10);
    } else {
      top10P = Math.min(0.99, probs[i] * riderScores.length / 10);
    }

    // Clamp
    podiumP = Math.max(0, Math.min(1, podiumP));
    top10P = Math.max(0, Math.min(1, top10P));

    podiumProbs.push(podiumP);
    top10Probs.push(top10P);
  }

  // 10. Delete existing predictions for this race, insert fresh ones
  await db.delete(schema.predictions).where(eq(schema.predictions.raceId, raceId!));

  const predictionValues = riderScores.map((r, i) => ({
    raceId: raceId!,
    riderId: r.riderId,
    predictedPosition: i + 1,
    winProbability: probs[i].toFixed(4),
    podiumProbability: podiumProbs[i].toFixed(4),
    top10Probability: top10Probs[i].toFixed(4),
    eloScore: r.eloMean.toFixed(4),
    rumourModifier: r.rumourModifier.toFixed(4),
    confidenceScore: r.uciPoints > 0 || r.eloMean !== 1500 ? "0.6000" : "0.3000",
    version: 1,
  }));

  // Insert in batches of 50
  for (let i = 0; i < predictionValues.length; i += 50) {
    const batch = predictionValues.slice(i, i + 50);
    await db.insert(schema.predictions).values(batch);
  }

  // 11. Print summary
  console.log(`\n${predictionValues.length} predictions generated for ${race.name}\n`);

  // Print top 10
  console.log("Top 10 predictions:");
  console.log("─".repeat(80));
  for (let i = 0; i < Math.min(10, riderScores.length); i++) {
    const r = riderScores[i];
    const winP = (probs[i] * 100).toFixed(1);
    const podP = (podiumProbs[i] * 100).toFixed(1);
    console.log(
      `  ${String(i + 1).padStart(2)}. ${r.riderName.padEnd(30)} ` +
        `ELO: ${r.eloMean.toFixed(0).padStart(5)}  UCI: ${String(r.uciPoints).padStart(5)}  ` +
        `Win: ${winP.padStart(5)}%  Podium: ${podP.padStart(5)}%  Score: ${r.score.toFixed(1)}`
    );
  }
  console.log("─".repeat(80));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
