import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, predictions, riderDisciplineStats, races, raceEvents } from '../../src/lib/db';
import { eq, and, isNotNull, gte, sql } from 'drizzle-orm';

async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Check Omloop predictions
  const omloopId = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';
  const preds = await db.select({
    rank: predictions.predictedPosition,
    eloRating: predictions.eloRating,
    uciPoints: predictions.uciPoints,
    score: predictions.predictionScore,
  }).from(predictions).where(eq(predictions.raceId, omloopId)).limit(5);
  
  console.log('\n📊 Omloop predictions (top 5):');
  preds.forEach(p => console.log(`  rank ${p.rank}: ELO=${p.eloRating} UCI=${p.uciPoints} score=${p.score}`));

  // Count road discipline stats
  const roadStats = await db.select({ c: sql<number>`count(*)` }).from(riderDisciplineStats)
    .where(eq(riderDisciplineStats.discipline, 'road'));
  console.log(`\n🏋 Road riderDisciplineStats rows: ${roadStats[0]?.c}`);

  const mtbStats = await db.select({ c: sql<number>`count(*)` }).from(riderDisciplineStats)
    .where(eq(riderDisciplineStats.discipline, 'mtb'));
  console.log(`🏋 MTB riderDisciplineStats rows: ${mtbStats[0]?.c}`);

  // Check predictions schema
  const sample = await db.select().from(predictions).limit(1);
  if (sample[0]) {
    console.log('\n📋 Prediction columns:', Object.keys(sample[0]).join(', '));
  }

  // Check how many Omloop predictions have eloRating set
  const withElo = await db.select({ c: sql<number>`count(*)` }).from(predictions)
    .where(and(eq(predictions.raceId, omloopId), isNotNull(predictions.eloRating)));
  const total = await db.select({ c: sql<number>`count(*)` }).from(predictions)
    .where(eq(predictions.raceId, omloopId));
  console.log(`\n📈 Omloop predictions: ${withElo[0]?.c} with ELO / ${total[0]?.c} total`);

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
