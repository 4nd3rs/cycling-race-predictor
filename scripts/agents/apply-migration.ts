import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../../src/lib/db';
import { sql } from 'drizzle-orm';

async function run() {
  await db.execute(sql`ALTER TABLE race_events ADD COLUMN IF NOT EXISTS external_links jsonb`);
  console.log('✅ Column external_links added to race_events');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
