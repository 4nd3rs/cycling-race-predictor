import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../src/lib/db';
import { raceStartlist, riderRumours, raceNews, riders } from '../src/lib/db/schema';
import { eq, sql, ilike, and } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL!;
const sqlDirect = neon(connectionString);

async function main() {
  // ── 1. Deduplicate men's startlist ─────────────────────────────────────────
  console.log('\n1. DEDUPLICATING MEN\'S STARTLIST...');
  const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';
  
  // Keep only the earliest entry per rider_id
  const deduped = await sqlDirect`
    DELETE FROM race_startlist
    WHERE race_id = ${MEN_RACE_ID}
    AND id NOT IN (
      SELECT DISTINCT ON (rider_id) id
      FROM race_startlist
      WHERE race_id = ${MEN_RACE_ID}
      ORDER BY rider_id, created_at ASC
    )
  `;
  console.log(`  Deleted duplicates. Count:`, (deduped as any).length ?? 'done');

  const [count] = await db.select({ count: sql<number>`count(*)` }).from(raceStartlist).where(eq(raceStartlist.raceId, MEN_RACE_ID));
  console.log(`  Men's startlist now has: ${count.count} entries`);

  // ── 2. Update Van Aert rumour (he's out) ────────────────────────────────────
  console.log('\n2. UPDATING VAN AERT RUMOUR...');
  const [wva] = await db.select({ id: riders.id, name: riders.name }).from(riders).where(ilike(riders.name, '%van aert%')).limit(1);
  if (wva) {
    await db.update(riderRumours).set({
      summary: 'Wout van Aert has been ruled out of Omloop Het Nieuwsblad 2026 due to illness. He will not start the race.',
      aggregateScore: '-1.000',
      lastUpdated: new Date(),
    }).where(eq(riderRumours.riderId, wva.id));
    console.log(`  Updated Van Aert (${wva.id}) rumour to: out/withdrawn`);
  } else {
    console.log('  Van Aert not found!');
  }

  // ── 3. Add race_id column to race_news (if not exists) ───────────────────────
  console.log('\n3. ADDING race_id COLUMN TO race_news...');
  try {
    await sqlDirect`ALTER TABLE race_news ADD COLUMN IF NOT EXISTS race_id UUID REFERENCES races(id)`;
    console.log('  Column added (or already existed)');
  } catch (e: any) {
    console.log('  Column error:', e.message);
  }

  // ── 4. Tag news articles with gender-specific race IDs ───────────────────────
  console.log('\n4. TAGGING NEWS ARTICLES WITH RACE IDs...');
  const MEN_RACE_ID2 = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';
  const WOMEN_RACE_ID = 'f6f9ae0b-13ef-4f29-accf-35719f187ccf';
  const EVENT_ID = 'db40d62b-b728-474c-9e84-d6f4277d31ac';

  const allNews = await db.select().from(raceNews).where(eq(raceNews.raceEventId, EVENT_ID));
  
  // Women-specific keywords
  const womenKeywords = ['kopecky', 'wiebes', 'vollering', 'niewiadoma', 'van vleuten', 'women', 'lotte', 'lorena', 'demi', 'kasia', 'elisa'];
  // Men-specific keywords
  const menKeywords = ['van der poel', 'philipsen', 'van aert', 'laporte', 'mathieu', 'wout', 'jasper', 'christophe', 'pogacar'];

  let womenTagged = 0, menTagged = 0, neutral = 0;
  
  for (const article of allNews) {
    const titleLower = article.title.toLowerCase();
    const isWomen = womenKeywords.some(kw => titleLower.includes(kw));
    const isMen = menKeywords.some(kw => titleLower.includes(kw));
    
    let raceId: string | null = null;
    if (isWomen && !isMen) {
      raceId = WOMEN_RACE_ID;
      womenTagged++;
    } else if (isMen && !isWomen) {
      raceId = MEN_RACE_ID2;
      menTagged++;
    } else {
      // Both or neither → keep null (shows for both)
      neutral++;
    }
    
    await sqlDirect`UPDATE race_news SET race_id = ${raceId} WHERE id = ${article.id}`;
    console.log(`  [${raceId ? (raceId === WOMEN_RACE_ID ? 'WOMEN' : 'MEN  ') : 'BOTH '}] ${article.title.substring(0, 70)}`);
  }
  
  console.log(`  Tagged: ${menTagged} men, ${womenTagged} women, ${neutral} neutral`);

  console.log('\n✅ All fixes applied!');
}

main().catch(console.error).finally(() => process.exit(0));
