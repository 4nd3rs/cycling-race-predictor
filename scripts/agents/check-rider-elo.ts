import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riders, riderDisciplineStats } from '../../src/lib/db';
import { ilike, eq, and } from 'drizzle-orm';

async function run() {
  for (const name of ['van der poel', 'van aert', 'philipsen', 'pedersen']) {
    const found = await db.select().from(riders).where(ilike(riders.name, `%${name}%`)).limit(1);
    if (!found[0]) { console.log(`${name}: NOT IN DB`); continue; }
    const stats = await db.select().from(riderDisciplineStats)
      .where(and(eq(riderDisciplineStats.riderId, found[0].id), eq(riderDisciplineStats.discipline, 'road'))).limit(1);
    const s = stats[0];
    console.log(`${found[0].name.padEnd(30)} elo=${s?.currentElo ?? 'NONE'} uci=${s?.uciPoints ?? 'NONE'} races=${s?.racesTotal ?? 'NONE'}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
