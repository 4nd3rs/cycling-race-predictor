import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../src/lib/db';
import { races, raceEvents } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const raceList = await db.select({ id: races.id, name: races.name, pcsUrl: races.pcsUrl, categorySlug: races.categorySlug })
    .from(races).where(eq(races.raceEventId, 'db40d62b-b728-474c-9e84-d6f4277d31ac'));
  console.log('Omloop races:', JSON.stringify(raceList, null, 2));

  // Check the event too
  const [event] = await db.select({ id: raceEvents.id, sourceUrl: raceEvents.sourceUrl }).from(raceEvents)
    .where(eq(raceEvents.id, 'db40d62b-b728-474c-9e84-d6f4277d31ac'));
  console.log('Event sourceUrl:', event?.sourceUrl);
}

main().catch(console.error).finally(() => process.exit(0));
