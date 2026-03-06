/**
 * Run all MTB data pipelines: predictions + ELO recalc for upcoming races
 * No Playwright, no external scraping — uses existing DB data
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, gte, sql, inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

const args = process.argv.slice(2);
const FORCE = args.includes("--force");

// ── TrueSkill helpers (copied from predictions-agent) ─────────────────────────

const BETA = 200;
const TAU = 25 / 3 / 100;

function pWin(muA: number, sigA: number, muB: number, sigB: number): number {
  const denom = Math.sqrt(2 * BETA * BETA + sigA * sigA + sigB * sigB);
  const z = (muA - muB) / denom;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign * y;
}

function winProbability(rider: { mu: number; sigma: number }, field: { mu: number; sigma: number }[]): number {
  return field.reduce((prob, opp) => prob * pWin(rider.mu, rider.sigma, opp.mu, opp.sigma), 1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split("T")[0];
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  console.log("🏔️  MTB Data Push\n");

  // Get upcoming MTB races with startlists
  const upcomingRaces = await sqlClient`
    SELECT r.id, r.date, r.age_category, r.gender, re.name, re.slug, re.discipline,
           (SELECT COUNT(*)::int FROM race_startlist rs WHERE rs.race_id = r.id) as startlist_count,
           (SELECT COUNT(*)::int FROM predictions p WHERE p.race_id = r.id) as prediction_count
    FROM races r
    JOIN race_events re ON re.id = r.race_event_id
    WHERE r.date BETWEEN ${today} AND ${weekOut}
    AND re.discipline = 'mtb'
    AND (SELECT COUNT(*) FROM race_startlist rs WHERE rs.race_id = r.id) > 0
    ORDER BY r.date
  `;

  console.log(`Found ${upcomingRaces.length} upcoming MTB races with startlists:\n`);
  upcomingRaces.forEach((r: any) => {
    const status = r.prediction_count === 0 ? "❌ needs preds" : 
                   r.prediction_count < r.startlist_count * 0.5 ? "⚠️  few preds" : "✅";
    console.log(`  ${String(r.date).substring(0,10)} ${r.name.substring(0,45)} (${r.age_category}/${r.gender}) - ${r.startlist_count}sl ${r.prediction_count}p ${status}`);
  });

  // Generate predictions for races that need them
  const racesNeedingPreds = upcomingRaces.filter((r: any) => 
    FORCE || r.prediction_count === 0 || r.prediction_count < r.startlist_count * 0.5
  );

  if (racesNeedingPreds.length === 0) {
    console.log("\n✅ All races have predictions.");
    return;
  }

  console.log(`\n📊 Generating predictions for ${racesNeedingPreds.length} races...\n`);

  for (const race of racesNeedingPreds) {
    const raceId = race.id;
    const ageCategory = race.age_category || "elite";
    const ageCategories = ageCategory === "u23" ? ["u23", "elite"] : [ageCategory];

    console.log(`── ${race.name.substring(0,50)} (${race.age_category}/${race.gender}) ──`);

    // Get startlist with stats
    const startlist = await db
      .select({
        entry: schema.raceStartlist,
        rider: schema.riders,
        stats: schema.riderDisciplineStats,
      })
      .from(schema.raceStartlist)
      .innerJoin(schema.riders, eq(schema.raceStartlist.riderId, schema.riders.id))
      .leftJoin(
        schema.riderDisciplineStats,
        and(
          eq(schema.riderDisciplineStats.riderId, schema.riders.id),
          eq(schema.riderDisciplineStats.discipline, "mtb"),
          inArray(schema.riderDisciplineStats.ageCategory, ageCategories)
        )
      )
      .where(eq(schema.raceStartlist.raceId, raceId));

    // Deduplicate
    const uniqueMap = new Map<string, typeof startlist[0]>();
    for (const row of startlist) {
      const existing = uniqueMap.get(row.rider.id);
      if (!existing || (row.stats?.uciPoints && !existing.stats?.uciPoints)) {
        uniqueMap.set(row.rider.id, row);
      }
    }
    const ridersList = Array.from(uniqueMap.values());
    console.log(`  Riders: ${ridersList.length}`);

    if (ridersList.length === 0) { console.log("  Skipping — no riders"); continue; }

    // Build field
    const field = ridersList.map(r => ({
      riderId: r.rider.id,
      mu: parseFloat(r.stats?.eloMean ?? "1500"),
      sigma: parseFloat(r.stats?.eloVariance ?? "350"),
      uciPoints: r.stats?.uciPoints ?? 0,
      uciRank: r.stats?.uciRank ?? 9999,
    }));

    // Compute win probabilities
    const scored = field.map(rider => {
      const others = field.filter(o => o.riderId !== rider.riderId);
      const eloProb = winProbability({ mu: rider.mu, sigma: rider.sigma }, others);
      
      // Blend ELO + UCI points (UCI weighted more when ELO data is sparse)
      const hasElo = rider.mu !== 1500 || rider.sigma !== 350;
      const uciScore = rider.uciPoints > 0 ? Math.log(rider.uciPoints + 1) / Math.log(3000) : 0;
      const eloScore = eloProb;
      
      const blended = hasElo ? (eloScore * 0.7 + uciScore * 0.3) : uciScore;
      return { ...rider, blended };
    });

    // Normalize to win probabilities
    const total = scored.reduce((s, r) => s + r.blended, 0);
    const withProbs = scored
      .map(r => ({ ...r, winProb: total > 0 ? r.blended / total : 1 / scored.length }))
      .sort((a, b) => b.winProb - a.winProb);

    // Delete existing predictions if forcing
    if (FORCE && race.prediction_count > 0) {
      await db.delete(schema.predictions).where(eq(schema.predictions.raceId, raceId));
    }

    // Skip if predictions exist and we're not forcing
    if (!FORCE && race.prediction_count > 0) {
      console.log(`  Skipping — ${race.prediction_count} predictions already exist`);
      continue;
    }

    // Insert predictions
    const toInsert = withProbs.slice(0, ridersList.length).map((r, i) => ({
      raceId,
      riderId: r.riderId,
      rank: i + 1,
      winProbability: r.winProb.toFixed(6),
      source: "elo" as const,
    }));

    await db.insert(schema.predictions).values(toInsert).onConflictDoNothing();
    console.log(`  ✅ Generated ${toInsert.length} predictions`);
    console.log(`     Top 3: ${withProbs.slice(0,3).map((r,i) => `${i+1}. ${r.winProb.toFixed(1).replace('0.','').substring(0,3)}%`).join(", ")}`);
    
    await new Promise(r => setTimeout(r, 200));
  }

  console.log("\n✅ Done");
}

main().catch(console.error);
