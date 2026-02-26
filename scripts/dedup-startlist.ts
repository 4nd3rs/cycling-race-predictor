import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  // Check for duplicates
  const dupes = await sql`
    SELECT rider_id, count(*) as cnt 
    FROM race_startlist 
    WHERE race_id = ${MEN_RACE_ID}
    GROUP BY rider_id 
    HAVING count(*) > 1 
    LIMIT 10
  `;
  console.log('Sample duplicate riders:', dupes.slice(0, 3));
  console.log('Total riders with duplicates:', dupes.length);

  const [total] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  console.log('Total rows before dedup:', total.count);

  // Delete duplicates: keep earliest created_at per rider
  const result = await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY rider_id ORDER BY created_at ASC) as rn
      FROM race_startlist
      WHERE race_id = ${MEN_RACE_ID}
    )
    DELETE FROM race_startlist
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  `;
  console.log('Delete result:', result);

  const [after] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  console.log('Total rows after dedup:', after.count);
}

main().catch(console.error).finally(() => process.exit(0));
