import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const rows = await sql`
    SELECT re.id as event_id, re.name as event_name,
           r.id as race_id, r.date, r.gender, r.age_category, r.status,
           COUNT(rr.id) as result_count
    FROM race_events re
    JOIN races r ON r.race_event_id = re.id
    LEFT JOIN race_results rr ON rr.race_id = r.id
    WHERE re.name ILIKE '%umag%'
    GROUP BY re.id, re.name, r.id, r.date, r.gender, r.age_category, r.status
    ORDER BY re.name, r.date
  `;
  console.log('UMAG:', JSON.stringify(rows, null, 2));

  const results = await sql`
    SELECT r.id as race_id, r.gender, re.name as event_name,
           rr.position, ri.name as rider_name
    FROM race_results rr
    JOIN races r ON rr.race_id = r.id
    JOIN race_events re ON r.race_event_id = re.id
    JOIN riders ri ON rr.rider_id = ri.id
    WHERE re.name ILIKE '%umag%'
      AND rr.position <= 3
    ORDER BY re.name, r.gender, rr.position
  `;
  console.log('UMAG RESULTS:', JSON.stringify(results, null, 2));
}
main().catch(console.error);
