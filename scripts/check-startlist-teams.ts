import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  // Check team_id distribution
  const [hasTeam] = await sql`
    SELECT count(*) FROM race_startlist 
    WHERE race_id = ${MEN_RACE_ID} AND team_id IS NOT NULL
  `;
  const [noTeam] = await sql`
    SELECT count(*) FROM race_startlist 
    WHERE race_id = ${MEN_RACE_ID} AND team_id IS NULL
  `;
  console.log('Has team_id:', hasTeam.count, '  No team_id:', noTeam.count);

  // Sample 5 entries
  const sample = await sql`
    SELECT rs.bib_number, rs.team_id, r.name as rider_name
    FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    WHERE rs.race_id = ${MEN_RACE_ID}
    ORDER BY rs.bib_number ASC NULLS LAST
    LIMIT 5
  `;
  console.log('Sample entries:', sample);

  // Now check if we need to re-run sync or if we can reconstruct team from rider's team_id
  const withRiderTeam = await sql`
    SELECT rs.bib_number, rs.team_id as startlist_team_id, r.name as rider_name, r.team_id as rider_team_id, t.name as rider_team_name
    FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    LEFT JOIN teams t ON t.id = r.team_id
    WHERE rs.race_id = ${MEN_RACE_ID}
    ORDER BY rs.bib_number ASC NULLS LAST
    LIMIT 10
  `;
  console.log('\nStartlist team vs rider team (first 5):');
  withRiderTeam.slice(0, 5).forEach(row => {
    console.log(`  Bib ${row.bib_number}: ${row.rider_name} | startlist_team=${row.startlist_team_id} | rider_team=${row.rider_team_name}`);
  });
}

main().catch(console.error).finally(() => process.exit(0));
