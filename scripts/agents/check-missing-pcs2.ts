import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../../src/lib/db';
import { races } from '../../src/lib/db/schema';
import { isNull, gte, lte, and, eq, ne } from 'drizzle-orm';

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const in14 = new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0];

  const r = await db.select({ id: races.id, name: races.name, date: races.date, pcsUrl: races.pcsUrl, discipline: races.discipline })
    .from(races)
    .where(and(
      isNull(races.pcsUrl),
      gte(races.date, today),
      lte(races.date, in14),
      ne(races.discipline, 'mtb')
    ));

  if (r.length === 0) {
    console.log('No road/gravel/cx races missing pcsUrl in the next 14 days.');
  } else {
    console.log(r.length + ' non-MTB race(s) missing pcsUrl:');
    for (const x of r) {
      console.log('  - [' + x.discipline + '] ' + x.name + ' (' + x.date + ')');
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
