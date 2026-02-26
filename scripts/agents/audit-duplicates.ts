import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riders, riderDisciplineStats } from '../../src/lib/db';
import { ilike, eq, and } from 'drizzle-orm';

async function check(search: string) {
  const found = await db.select().from(riders).where(ilike(riders.name, `%${search}%`));
  for (const r of found) {
    const stats = await db.select().from(riderDisciplineStats)
      .where(and(eq(riderDisciplineStats.riderId, r.id), eq(riderDisciplineStats.discipline, 'road'))).limit(1);
    const s = stats[0];
    console.log(`  [${r.id.slice(0,8)}] "${r.name}" → ELO=${s?.currentElo ?? 'NONE'} UCI=${s?.uciPoints ?? 'NONE'} races=${s?.racesTotal ?? 'NONE'}`);
  }
}

async function run() {
  console.log('=== Van der Poel ==='); await check('poel');
  console.log('\n=== Philipsen ==='); await check('philipsen');
  console.log('\n=== Arnaud De Lie ==='); await check('de lie');
  console.log('\n=== Van Aert ==='); await check('van aert');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
