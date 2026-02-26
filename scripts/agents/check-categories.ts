import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, races, raceEvents } from '../../src/lib/db';
import { gte, eq, and } from 'drizzle-orm';

async function run() {
  const today = new Date().toISOString().split('T')[0];
  const rows = await db.select({ cat: races.uciCategory, disc: raceEvents.discipline, name: raceEvents.name, date: raceEvents.date })
    .from(races).innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(gte(raceEvents.date, today), eq(races.status, 'active')))
    .orderBy(raceEvents.date).limit(30);
  rows.forEach(r => console.log(r.date, (r.disc||'').padEnd(6), (r.cat || '(null)').padEnd(14), r.name?.substring(0,45)));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
