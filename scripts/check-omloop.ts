import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../src/lib/db';
import { races, raceEvents, raceStartlist, riders, riderRumours, raceNews } from '../src/lib/db/schema';
import { eq, sql, ilike } from 'drizzle-orm';

async function main() {
  // Get event
  const [event] = await db.select().from(raceEvents).where(eq(raceEvents.slug, 'omloop-het-nieuwsblad-2026')).limit(1);
  console.log('Event:', event?.id, event?.name, 'discipline:', event?.discipline);

  // Get races under this event
  const raceList = await db.select().from(races).where(eq(races.raceEventId, event.id));
  console.log('Races:', raceList.map(r => ({ id: r.id, name: r.name, categorySlug: r.categorySlug, gender: r.gender, ageCategory: r.ageCategory })));

  // Count startlist for each race
  for (const race of raceList) {
    const [count] = await db.select({ count: sql<number>`count(*)` }).from(raceStartlist).where(eq(raceStartlist.raceId, race.id));
    console.log(`  ${race.categorySlug || race.name}: ${count.count} startlist entries`);
  }

  // Check for Van Aert
  const wva = await db.select({ id: riders.id, name: riders.name }).from(riders).where(ilike(riders.name, '%van aert%')).limit(5);
  console.log('\nVan Aert riders:', wva);

  // Check Van Aert rumour
  if (wva.length > 0) {
    const rumours = await db.select().from(riderRumours).where(eq(riderRumours.riderId, wva[0].id)).limit(3);
    console.log('Van Aert rumours:', rumours.map(r => ({ summary: r.summary?.substring(0, 120), score: r.aggregateScore, sentiment: r.sentiment })));
  }

  // Check race_news for the event
  const news = await db.select({ id: raceNews.id, title: raceNews.title, category: raceNews.category }).from(raceNews).where(eq(raceNews.raceEventId, event.id));
  console.log(`\nNews articles (${news.length}):`);
  news.forEach(n => console.log(' -', n.title.substring(0, 80)));
}

main().catch(console.error).finally(() => process.exit(0));
