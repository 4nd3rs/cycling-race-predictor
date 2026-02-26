import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, raceStartlist, riders } from '../../src/lib/db';
import { eq } from 'drizzle-orm';

async function run() {
  const omloopId = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';
  const entries = await db.select({ riderId: raceStartlist.riderId })
    .from(raceStartlist).where(eq(raceStartlist.raceId, omloopId)).limit(5);
  
  for (const e of entries) {
    const r = await db.query.riders.findFirst({ where: eq(riders.id, e.riderId) });
    console.log(`  [${e.riderId.slice(0,8)}] "${r?.name}"`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
