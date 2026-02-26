import { config } from 'dotenv';
config({ path: '/Users/amalabs/cycling-race-predictor/.env.local' });
import { neon } from '@neondatabase/serverless';
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`;
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS website VARCHAR(500)`;
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS twitter VARCHAR(500)`;
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS instagram VARCHAR(500)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS teams_slug_unique ON teams(slug) WHERE slug IS NOT NULL`;
  console.log('Teams migration done');
}
main().catch(console.error);
