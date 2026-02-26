import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  // Check bib number distribution
  const bibs = await sql`
    SELECT bib_number, count(*) as cnt 
    FROM race_startlist 
    WHERE race_id = ${MEN_RACE_ID}
    GROUP BY bib_number 
    HAVING count(*) > 1 
    ORDER BY cnt DESC
    LIMIT 10
  `;
  console.log('Duplicate bibs:', bibs);

  // Count null bibs
  const [nullBibs] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID} AND bib_number IS NULL`;
  console.log('Null bib_number entries:', nullBibs.count);

  // Sample the data - show first 10
  const sample = await sql`
    SELECT id, rider_id, bib_number, team_id, created_at
    FROM race_startlist
    WHERE race_id = ${MEN_RACE_ID}
    ORDER BY created_at ASC, bib_number ASC NULLS LAST
    LIMIT 10
  `;
  console.log('\nFirst 10 entries:', sample);

  // Check if there are entries with bib_number NULL alongside bib entries for same rider
  const overlap = await sql`
    SELECT rs1.rider_id
    FROM race_startlist rs1
    JOIN race_startlist rs2 ON rs1.rider_id = rs2.rider_id AND rs1.race_id = rs2.race_id AND rs1.id != rs2.id
    WHERE rs1.race_id = ${MEN_RACE_ID}
    LIMIT 5
  `;
  console.log('\nActual overlapping rider_id pairs:', overlap);

  // Count unique rider_ids vs total
  const [unique] = await sql`SELECT count(DISTINCT rider_id) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  const [total] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  console.log('\nUnique riders:', unique.count, 'Total rows:', total.count);
}

main().catch(console.error).finally(() => process.exit(0));
