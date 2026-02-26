import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE_ID = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  const teams = await sql`
    SELECT t.name, count(*) as riders
    FROM race_startlist rs
    JOIN teams t ON t.id = rs.team_id
    WHERE rs.race_id = ${MEN_RACE_ID}
    GROUP BY t.name
    ORDER BY t.name
  `;
  console.log(`\nTeams in Men's Omloop (${teams.length} teams):`);
  teams.forEach(t => console.log(`  ${t.name}: ${t.riders} riders`));
  
  const [total] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE_ID}`;
  console.log(`\nTotal riders: ${total.count}`);

  // Check Van Aert (should not be in startlist)
  const wva = await sql`
    SELECT r.name FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    WHERE rs.race_id = ${MEN_RACE_ID} AND lower(r.name) LIKE '%van aert%'
  `;
  console.log('\nVan Aert in startlist:', wva.length ? wva : 'NOT PRESENT ✓ (correctly withdrawn)');
}

main().catch(console.error).finally(() => process.exit(0));
