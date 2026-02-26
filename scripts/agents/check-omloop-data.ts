import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, races, raceEvents } from '../../src/lib/db';
import { eq } from 'drizzle-orm';

async function run() {
  const ev = await db.query.raceEvents.findFirst({ where: eq(raceEvents.id, '8d573dfa-1b3d-4c09-b89a-4d80b51c9c3b') }); // wrong, let me find it
  const events = await db.select().from(raceEvents).where(eq(raceEvents.slug, 'omloop-het-nieuwsblad-2026')).limit(1);
  if (events[0]) {
    const e = events[0];
    console.log('Event:', JSON.stringify({ name: e.name, country: e.country, pcsUrl: e.pcsUrl, dist: e.distanceKm, elev: e.elevationM, links: e.externalLinks }, null, 2));
    const race = await db.query.races.findFirst({ where: eq(races.raceEventId, e.id) });
    if (race) console.log('Race:', JSON.stringify({ profileType: race.profileType, raceType: race.raceType, dist: race.distanceKm, elev: race.elevationM, pcsUrl: race.pcsUrl }, null, 2));
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
