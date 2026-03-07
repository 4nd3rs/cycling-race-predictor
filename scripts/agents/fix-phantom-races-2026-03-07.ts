/**
 * One-off fix: 2026-03-07
 *
 * Removes phantom/duplicate race rows that cause corrupted Latest Results cards:
 *
 * 1. Beobank Samyn Ladies — phantom gender="men" race with women's riders
 * 2. Trofeo Laigueglia   — phantom gender="women" race with men's riders
 * 3. UMAG Classic Ladies — phantom gender="men" race + duplicate women's race
 *    (both sets of results already exist correctly under "UMAG Classic" event)
 */

import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const PHANTOM_RACES = [
    {
      id: 'f4bb7a7f-8243-42c4-9073-40453cf12586',
      desc: 'Beobank Samyn Ladies — phantom men race (has women riders)',
    },
    {
      id: '65e035e4-7bac-4607-943d-73c60c488f82',
      desc: 'Trofeo Laigueglia — phantom women race (has men riders BUITRAGO/GRÉGOIRE/TIBERI)',
    },
    {
      id: '1227aeb0-9f3e-43e0-8989-2a6aec9b4757',
      desc: 'UMAG Classic Ladies — phantom men race (men results belong to UMAG Classic)',
    },
    {
      id: '470c4f41-f64c-482f-b90e-c6ffde114718',
      desc: 'UMAG Classic Ladies — duplicate women race (same results as UMAG Classic women)',
    },
  ];

  for (const { id, desc } of PHANTOM_RACES) {
    // Count results before deleting
    const [{ count }] = await sql`
      SELECT COUNT(*) as count FROM race_results WHERE race_id = ${id}
    `;
    console.log(`\n[${desc}]`);
    console.log(`  Race ID: ${id}`);
    console.log(`  Results to delete: ${count}`);

    // Delete results first (FK constraint)
    const delResults = await sql`
      DELETE FROM race_results WHERE race_id = ${id}
    `;
    console.log(`  ✓ Deleted ${count} results`);

    // Delete the race row
    await sql`DELETE FROM races WHERE id = ${id}`;
    console.log(`  ✓ Deleted race row`);
  }

  console.log('\n✅ All phantom races cleaned up.');

  // Verify: show remaining races for affected events
  const verify = await sql`
    SELECT re.name as event_name, r.id, r.gender, r.age_category, r.date,
           COUNT(rr.id) as result_count
    FROM races r
    JOIN race_events re ON r.race_event_id = re.id
    LEFT JOIN race_results rr ON rr.race_id = r.id
    WHERE re.name ILIKE ANY(ARRAY['%samyn%', '%beobank%', '%laigueglia%', '%umag%'])
      AND r.date >= '2026-01-01'
    GROUP BY re.name, r.id, r.gender, r.age_category, r.date
    ORDER BY re.name, r.date, r.gender
  `;
  console.log('\nRemaining 2026 races for affected events:');
  for (const r of verify) {
    console.log(`  ${r.event_name} | ${r.gender} ${r.age_category} | ${r.date?.toString().substring(0,10)} | ${r.result_count} results | id:${r.id}`);
  }
}

main().catch(console.error);
