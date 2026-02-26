import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const r = await sql`SELECT DISTINCT discipline, gender, COUNT(*) as cnt FROM rider_discipline_stats GROUP BY discipline, gender ORDER BY discipline, cnt DESC`;
  console.log(JSON.stringify(r, null, 2));
}
main();
