import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../../src/lib/db';
import { races } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

const updates = [
  { id: '7cc714ef-208e-4eb3-8110-9f5fa9c4f5a8', name: 'In Flanders Fields - From Middelkerke to Wevelgem - Elite Men',   pcsUrl: 'https://www.procyclingstats.com/race/gent-wevelgem/2026' },
  { id: '69d8f623-e36f-431d-893f-17e83a9cbb0e', name: 'In Flanders Fields - From Middelkerke to Wevelgem - Elite Women', pcsUrl: 'https://www.procyclingstats.com/race/gent-wevelgem-in-flanders-fields-we/2026' },
];

async function main() {
  for (const u of updates) {
    await db.update(races).set({ pcsUrl: u.pcsUrl }).where(eq(races.id, u.id));
    console.log('✅', u.name, '->', u.pcsUrl);
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
