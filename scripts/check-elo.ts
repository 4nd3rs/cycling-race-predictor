import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';

async function main() {
  const [total] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${MEN_RACE}`;
  
  // How many startlist riders have ELO > 1500?
  const [hasElo] = await sql`
    SELECT count(*) as cnt FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    JOIN rider_discipline_stats ds ON ds.rider_id = r.id AND ds.discipline = 'road'
    WHERE rs.race_id = ${MEN_RACE} AND ds.current_elo > 1500
  `;
  console.log(`Riders with ELO > 1500: ${hasElo.cnt} / ${total.count}`);

  // Check MVDP - is he in the startlist?
  const mvdp = await sql`
    SELECT r.name, r.pcs_id, ds.current_elo, ds.uci_points
    FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    LEFT JOIN rider_discipline_stats ds ON ds.rider_id = r.id AND ds.discipline = 'road'
    WHERE rs.race_id = ${MEN_RACE} AND lower(r.name) LIKE '%poel%'
  `;
  console.log('MVDP entry:', mvdp);

  // Check Philipsen
  const phil = await sql`
    SELECT r.name, r.pcs_id, ds.current_elo, ds.uci_points
    FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    LEFT JOIN rider_discipline_stats ds ON ds.rider_id = r.id AND ds.discipline = 'road'
    WHERE rs.race_id = ${MEN_RACE} AND lower(r.name) LIKE '%philipsen%'
  `;
  console.log('Philipsen entry:', phil);

  // Top 5 by ELO in startlist
  const top5 = await sql`
    SELECT r.name, ds.current_elo, ds.uci_points FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    JOIN rider_discipline_stats ds ON ds.rider_id = r.id AND ds.discipline = 'road'
    WHERE rs.race_id = ${MEN_RACE}
    ORDER BY ds.current_elo DESC NULLS LAST LIMIT 5
  `;
  console.log('Top 5 by ELO:', top5);
  
  // How many riders have pcs_id set?
  const [hasPcs] = await sql`
    SELECT count(*) as cnt FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    WHERE rs.race_id = ${MEN_RACE} AND r.pcs_id IS NOT NULL
  `;
  console.log(`Riders with pcs_id: ${hasPcs.cnt} / ${total.count}`);
}
main().catch(console.error).finally(() => process.exit(0));
