import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const beobank = await sql`
    SELECT re.id as event_id, re.name as event_name, re.slug,
           r.id as race_id, r.date, r.gender, r.age_category, r.status,
           COUNT(rr.id) as result_count
    FROM race_events re
    JOIN races r ON r.race_event_id = re.id
    LEFT JOIN race_results rr ON rr.race_id = r.id
    WHERE re.name ILIKE '%samyn%' OR re.name ILIKE '%beobank%'
    GROUP BY re.id, re.name, re.slug, r.id, r.date, r.gender, r.age_category, r.status
    ORDER BY re.name, r.date
  `;
  console.log('BEOBANK/SAMYN:\n', JSON.stringify(beobank, null, 2));

  const laigueglia = await sql`
    SELECT re.id as event_id, re.name as event_name,
           r.id as race_id, r.date, r.gender, r.age_category, r.status,
           COUNT(rr.id) as result_count
    FROM race_events re
    JOIN races r ON r.race_event_id = re.id
    LEFT JOIN race_results rr ON rr.race_id = r.id
    WHERE re.name ILIKE '%laigueglia%'
    GROUP BY re.id, re.name, r.id, r.date, r.gender, r.age_category, r.status
  `;
  console.log('LAIGUEGLIA:\n', JSON.stringify(laigueglia, null, 2));

  // Check top 3 results for each race to see what's in there
  const samynResults = await sql`
    SELECT r.id as race_id, r.gender, re.name as event_name,
           rr.position, ri.name as rider_name, ri.nationality
    FROM race_results rr
    JOIN races r ON rr.race_id = r.id
    JOIN race_events re ON r.race_event_id = re.id
    JOIN riders ri ON rr.rider_id = ri.id
    WHERE (re.name ILIKE '%samyn%' OR re.name ILIKE '%beobank%')
      AND rr.position <= 3
    ORDER BY re.name, r.gender, rr.position
  `;
  console.log('SAMYN RESULTS:\n', JSON.stringify(samynResults, null, 2));

  const laigResults = await sql`
    SELECT r.id as race_id, r.gender, re.name as event_name,
           rr.position, ri.name as rider_name
    FROM race_results rr
    JOIN races r ON rr.race_id = r.id
    JOIN race_events re ON r.race_event_id = re.id
    JOIN riders ri ON rr.rider_id = ri.id
    WHERE re.name ILIKE '%laigueglia%'
      AND rr.position <= 3
    ORDER BY r.gender, rr.position
  `;
  console.log('LAIGUEGLIA RESULTS:\n', JSON.stringify(laigResults, null, 2));
}

main().catch(console.error);
