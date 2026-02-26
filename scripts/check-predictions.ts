import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const men = await sql`
    SELECT p.predicted_position, p.win_probability, p.confidence_score, r.name
    FROM predictions p
    JOIN riders r ON r.id = p.rider_id
    WHERE p.race_id = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01'
    ORDER BY p.predicted_position ASC
    LIMIT 10
  `;
  console.log("Men's top 10:");
  men.forEach(p => console.log(`  #${p.predicted_position} ${p.name}: win_prob=${p.win_probability}, confidence=${p.confidence_score}`));

  // Check how many have non-null / non-zero win_probability
  const [stats] = await sql`
    SELECT 
      count(*) as total,
      count(win_probability) as has_prob,
      count(CASE WHEN win_probability > 0 THEN 1 END) as nonzero_prob,
      max(win_probability) as max_prob
    FROM predictions
    WHERE race_id = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01'
  `;
  console.log('\nStats:', stats);
}

main().catch(console.error).finally(() => process.exit(0));
