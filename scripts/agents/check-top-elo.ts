import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riders, riderDisciplineStats } from '../../src/lib/db';
import { eq, and, gt, desc } from 'drizzle-orm';

async function run() {
  const top = await db.select({ riderId: riderDisciplineStats.riderId, uci: riderDisciplineStats.uciPoints, elo: riderDisciplineStats.currentElo, races: riderDisciplineStats.racesTotal })
    .from(riderDisciplineStats)
    .where(and(eq(riderDisciplineStats.discipline, 'road'), gt(riderDisciplineStats.uciPoints, 500)))
    .orderBy(desc(riderDisciplineStats.uciPoints)).limit(15);
  
  for (const r of top) {
    const rider = await db.query.riders.findFirst({ where: eq(riders.id, r.riderId) });
    console.log(`  ${(rider?.name || '?').padEnd(35)} UCI=${String(r.uci).padEnd(6)} ELO=${r.elo} races=${r.races}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
