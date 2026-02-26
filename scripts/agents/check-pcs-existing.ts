import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../../src/lib/db';
import { races } from '../../src/lib/schema';
import { isNotNull } from 'drizzle-orm';

async function main() {
  const r = await db.select({ name: races.name, pcsUrl: races.pcsUrl, gender: races.gender })
    .from(races)
    .where(isNotNull(races.pcsUrl))
    .limit(30);
  for (const x of r) {
    console.log(`${x.name} | ${x.gender} | ${x.pcsUrl}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
