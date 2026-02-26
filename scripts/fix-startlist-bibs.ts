import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  // The 164 null-bib entries are stale/mismatched from first sync
  // The 175 bib-numbered entries are the correct PCS startlist
  // Delete the nulls
  const result = await sql`
    DELETE FROM race_startlist
    WHERE race_id = ${MEN_RACE_ID}
    AND bib_number IS NULL
  `;
  console.log('Deleted null-bib entries:', result);

  const [after] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  console.log('Men startlist after fix:', after.count, 'riders (with bib numbers)');

  // Also check distribution by team
  const teams = await sql`
    SELECT t.name, count(*) as riders
    FROM race_startlist rs
    LEFT JOIN teams t ON t.id = rs.team_id
    WHERE rs.race_id = ${MEN_RACE_ID}
    GROUP BY t.name
    ORDER BY t.name
    LIMIT 10
  `;
  console.log('\nSample teams:', teams.slice(0, 8));
}

main().catch(console.error).finally(() => process.exit(0));
