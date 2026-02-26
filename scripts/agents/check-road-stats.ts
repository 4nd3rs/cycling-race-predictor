import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riderDisciplineStats, riders } from '../../src/lib/db';
import { eq, and, gt, sql } from 'drizzle-orm';

async function run() {
  const road = await db.select({ c: sql<number>`count(*)` }).from(riderDisciplineStats)
    .where(eq(riderDisciplineStats.discipline, 'road'));
  console.log(`\nRoad discipline stats rows: ${road[0]?.c}`);

  const withPts = await db.select({
    uciPoints: riderDisciplineStats.uciPoints,
    elo: riderDisciplineStats.currentElo,
    ageCategory: riderDisciplineStats.ageCategory,
    gender: riderDisciplineStats.gender,
    riderId: riderDisciplineStats.riderId,
  }).from(riderDisciplineStats)
    .where(and(eq(riderDisciplineStats.discipline, 'road'), gt(riderDisciplineStats.uciPoints, 0)))
    .limit(10);

  console.log(`\nTop road riders with UCI points:`);
  for (const r of withPts) {
    const rider = await db.query.riders.findFirst({ where: eq(riders.id, r.riderId) });
    console.log(`  ${rider?.name?.padEnd(30)} UCI=${r.uciPoints} ELO=${r.elo}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
