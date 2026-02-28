/**
 * Generate Predictions Agent
 *
 * Uses the TrueSkill-based rating system (μ - 3σ conservative estimate) to
 * generate race predictions. Riders with no race history are ranked below all
 * rated riders; UCI points provide a weak bootstrap signal within that band.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/agents/generate-predictions.ts --race-id <uuid>
 *   node_modules/.bin/tsx scripts/agents/generate-predictions.ts --days 3
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import {
  calculateElo,
  calculateAllProbabilities,
  type RiderSkill,
} from "../../src/lib/prediction/trueskill";
import { notifyRaceEventFollowers } from "./lib/notify-followers";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const raceIdIdx = args.indexOf("--race-id");
const SINGLE_RACE_ID = raceIdIdx !== -1 ? args[raceIdIdx + 1] : null;
const daysIdx = args.indexOf("--days");
const daysAhead = daysIdx !== -1 ? parseInt(args[daysIdx + 1]) : null;

const MIN_STARTLIST = 3;

async function generateForRace(raceId: string): Promise<void> {
  const race = await db.query.races.findFirst({
    where: eq(schema.races.id, raceId),
  });
  if (!race) { console.error(`Race not found: ${raceId}`); return; }

  const { discipline, ageCategory = "elite", gender = "men" } = race;
  console.log(`\n🏁 ${race.name} (${race.date})  [${discipline}/${ageCategory}/${gender}]`);

  const startlistEntries = await db.query.raceStartlist.findMany({
    where: eq(schema.raceStartlist.raceId, raceId),
    with: { rider: true },
  });

  if (startlistEntries.length < MIN_STARTLIST) {
    console.log(`   ⏭  Only ${startlistEntries.length} riders — skipping`);
    return;
  }

  console.log(`   Riders: ${startlistEntries.length}`);

  const skillsMap = new Map<string, RiderSkill>();
  const riderMeta = new Map<string, {
    name: string; racesTotal: number; uciPoints: number; rumourModifier: number;
  }>();

  for (const entry of startlistEntries) {
    const rider = entry.rider;
    if (!rider) continue;

    let stats = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(schema.riderDisciplineStats.riderId, rider.id),
        eq(schema.riderDisciplineStats.discipline, discipline),
        eq(schema.riderDisciplineStats.ageCategory, ageCategory)
      ),
    });

    if (!stats) {
      await db.insert(schema.riderDisciplineStats).values({
        riderId: rider.id, discipline, ageCategory, gender,
        currentElo: "1500", eloMean: "1500", eloVariance: "500",
        racesTotal: 0, uciPoints: 0,
      }).onConflictDoNothing();

      stats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(schema.riderDisciplineStats.riderId, rider.id),
          eq(schema.riderDisciplineStats.discipline, discipline),
          eq(schema.riderDisciplineStats.ageCategory, ageCategory)
        ),
      });
    }

    const racesTotal = stats?.racesTotal ?? 0;
    const uciPoints = stats?.uciPoints ?? 0;

    let skill: RiderSkill;
    if (racesTotal === 0) {
      // Unranked band: conservative estimate will be ~0–200, always below rated riders
      // (rated floor: mean=1500, σ=350 → conservative = 1500 - 3*350 = 450)
      const uciBoost = Math.min(uciPoints / 500 * 200, 200);
      skill = { riderId: rider.id, mean: 300 + uciBoost, variance: 100 * 100 };
    } else {
      const mean = parseFloat(stats?.eloMean || "1500");
      const sigma = parseFloat(stats?.eloVariance || "350");
      skill = { riderId: rider.id, mean, variance: sigma * sigma };
    }

    // Apply rumour as mean nudge (±5%)
    const rumour = await db.query.riderRumours.findFirst({
      where: and(eq(schema.riderRumours.riderId, rider.id), eq(schema.riderRumours.raceId, raceId)),
    });
    const generalRumour = !rumour
      ? await db.query.riderRumours.findFirst({ where: eq(schema.riderRumours.riderId, rider.id) })
      : null;
    const rumourSentiment = rumour
      ? parseFloat(rumour.aggregateScore || "0")
      : generalRumour ? parseFloat(generalRumour.aggregateScore || "0") : 0;

    if (rumourSentiment !== 0) {
      skill = { ...skill, mean: skill.mean * (1 + rumourSentiment * 0.05) };
    }

    skillsMap.set(rider.id, skill);
    riderMeta.set(rider.id, { name: rider.name, racesTotal, uciPoints, rumourModifier: rumourSentiment * 0.05 });
  }

  // Monte-Carlo probability simulation via TrueSkill
  const probabilities = calculateAllProbabilities(skillsMap);

  // Rank by μ - 3σ conservative estimate
  const ranked = Array.from(skillsMap.entries())
    .map(([riderId, skill]) => ({
      riderId, skill,
      conservativeRating: calculateElo(skill.mean, skill.variance),
      meta: riderMeta.get(riderId)!,
      probs: probabilities.get(riderId) ?? { win: 0, podium: 0, top10: 0 },
    }))
    .sort((a, b) => b.conservativeRating - a.conservativeRating);

  await db.delete(schema.predictions).where(eq(schema.predictions.raceId, raceId));

  const predictionValues = ranked.map((r, i) => ({
    raceId, riderId: r.riderId,
    predictedPosition: i + 1,
    winProbability: r.probs.win.toFixed(4),
    podiumProbability: r.probs.podium.toFixed(4),
    top10Probability: r.probs.top10.toFixed(4),
    eloScore: r.conservativeRating.toFixed(4),
    rumourModifier: r.meta.rumourModifier.toFixed(4),
    confidenceScore: r.meta.racesTotal > 0
      ? r.meta.uciPoints > 0 ? "0.7000" : "0.5000"
      : r.meta.uciPoints > 0 ? "0.3000" : "0.1000",
    version: 1,
  }));

  for (let i = 0; i < predictionValues.length; i += 50) {
    await db.insert(schema.predictions).values(predictionValues.slice(i, i + 50));
  }

  console.log(`   ✅ ${predictionValues.length} predictions saved`);
  console.log(`   Top 5:`);
  for (const r of ranked.slice(0, 5)) {
    const label = r.meta.racesTotal > 0
      ? `μ=${r.skill.mean.toFixed(0)} σ=${Math.sqrt(r.skill.variance).toFixed(0)} → ${r.conservativeRating.toFixed(0)}`
      : `unranked (uci=${r.meta.uciPoints})`;
    console.log(`     ${String(ranked.indexOf(r) + 1).padStart(2)}. ${r.meta.name.padEnd(28)} win=${(r.probs.win * 100).toFixed(1)}%  [${label}]`);
  }

  try { await notifyRaceEventFollowers(raceId); } catch (_) {}
}

async function main() {
  if (SINGLE_RACE_ID) {
    await generateForRace(SINGLE_RACE_ID);
    return;
  }

  const days = daysAhead ?? 3;
  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

  const races = await db.query.races.findMany({
    where: and(eq(schema.races.status, "active"), gte(schema.races.date, today), lte(schema.races.date, maxDate)),
    orderBy: (r, { asc }) => [asc(r.date)],
  });

  if (races.length === 0) { console.log("No active races in window."); return; }
  console.log(`Found ${races.length} races in next ${days} day(s)\n`);

  let generated = 0, skipped = 0;

  for (const race of races) {
    const startlistSize = await db.query.raceStartlist
      .findMany({ where: eq(schema.raceStartlist.raceId, race.id) })
      .then((r) => r.length);

    if (startlistSize < MIN_STARTLIST) {
      console.log(`  ⏭  ${race.name} — ${startlistSize} riders`);
      skipped++; continue;
    }

    const existing = await db.query.predictions.findFirst({
      where: eq(schema.predictions.raceId, race.id),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });

    if (existing?.createdAt) {
      const ageHours = (Date.now() - new Date(existing.createdAt).getTime()) / 3600000;
      if (ageHours < 1) {
        console.log(`  ⏭  ${race.name} — fresh (${ageHours.toFixed(1)}h ago)`);
        skipped++; continue;
      }
    }

    await generateForRace(race.id);
    generated++;
  }

  console.log(`\nDone — ${generated} generated, ${skipped} skipped`);
}

main().catch(console.error);
