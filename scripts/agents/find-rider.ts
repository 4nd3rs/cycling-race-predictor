import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riders, riderDisciplineStats } from '../../src/lib/db';
import { ilike, eq, and, gt } from 'drizzle-orm';

async function run() {
  // Search for van der poel variants
  const found = await db.select({ id: riders.id, name: riders.name }).from(riders)
    .where(ilike(riders.name, '%poel%'));
  console.log('Poel matches:', found.map(r => `"${r.name}"`));

  // Top road stats
  const topRoad = await db.select({ riderId: riderDisciplineStats.riderId, uci: riderDisciplineStats.uciPoints, elo: riderDisciplineStats.currentElo })
    .from(riderDisciplineStats)
    .where(and(eq(riderDisciplineStats.discipline, 'road'), gt(riderDisciplineStats.uciPoints, 1000)))
    .limit(10);
  console.log('\nTop road by UCI pts:');
  for (const r of topRoad) {
    const rider = await db.query.riders.findFirst({ where: eq(riders.id, r.riderId) });
    console.log(`  "${rider?.name}" UCI=${r.uci} ELO=${r.elo}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
