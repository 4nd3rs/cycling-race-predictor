import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../../src/lib/db';
import { races } from '../../src/lib/db/schema';
import { isNull, gte, lte, and } from 'drizzle-orm';

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const in14 = new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0];

  const r = await db.select({ id: races.id, name: races.name, slug: races.categorySlug, date: races.date, pcsUrl: races.pcsUrl })
    .from(races)
    .where(and(
      isNull(races.pcsUrl),
      gte(races.date, today),
      lte(races.date, in14)
    ));

  if (r.length === 0) {
    console.log('No races missing pcsUrl in the next 14 days.');
  } else {
    console.log(r.length + ' race(s) missing pcsUrl:');
    for (const x of r) {
      console.log('  - ' + x.name + ' (' + x.date + ') slug=' + x.slug);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
