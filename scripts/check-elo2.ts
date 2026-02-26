import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Top 20 riders by ELO in DB
  const top20 = await sql`
    SELECT r.name, ds.current_elo, ds.uci_points, ds.wins_total, ds.races_total
    FROM rider_discipline_stats ds
    JOIN riders r ON r.id = ds.rider_id
    WHERE ds.discipline = 'road'
    ORDER BY ds.current_elo DESC LIMIT 20
  `;
  console.log('Top 20 road riders by ELO:');
  top20.forEach(r => console.log(`  ${r.name}: ELO=${r.current_elo} UCI=${r.uci_points} wins=${r.wins_total} races=${r.races_total}`));
  
  // How many have ELO > 1500?
  const [cnt] = await sql`SELECT count(*) FROM rider_discipline_stats WHERE discipline = 'road' AND current_elo > 1500`;
  const [total] = await sql`SELECT count(*) FROM rider_discipline_stats WHERE discipline = 'road'`;
  console.log(`\nELO > 1500: ${cnt.count} / ${total.count} road riders`);
  
  // Check if ELO calc has been run (any race_results exist for road?)
  const [results] = await sql`SELECT count(*) FROM race_results rr JOIN races ra ON ra.id = rr.race_id WHERE ra.discipline = 'road'`;
  console.log(`Road race results in DB: ${results.count}`);
}
main().catch(console.error).finally(() => process.exit(0));
