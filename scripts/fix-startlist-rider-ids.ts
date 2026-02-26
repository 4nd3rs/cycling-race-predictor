/**
 * Fix startlist rider IDs — the PCS sync created new rider records (ALL-CAPS names, ELO=1500)
 * but the UCI sync had already created the same riders with real ELO scores.
 * This script re-points startlist entries to the canonical riders that have real ELO data.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const MEN_RACE = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01';
const WOMEN_RACE = 'f6f9ae0b-13ef-4f29-accf-35719f187ccf';

// Normalize name for matching: lowercase, strip accents, sort words
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

async function fixRace(raceId: string, raceName: string) {
  console.log(`\n=== Fixing ${raceName} ===`);

  // Get all startlist riders with ELO = 1500 (default, no real data)
  const noEloRiders = await sql`
    SELECT rs.id as entry_id, rs.rider_id, rs.bib_number, r.name, r.pcs_id, ds.current_elo
    FROM race_startlist rs
    JOIN riders r ON r.id = rs.rider_id
    LEFT JOIN rider_discipline_stats ds ON ds.rider_id = r.id AND ds.discipline = 'road'
    WHERE rs.race_id = ${raceId}
    AND (ds.current_elo IS NULL OR ds.current_elo <= 1500)
    ORDER BY rs.bib_number
  `;
  console.log(`  Riders with ELO <= 1500: ${noEloRiders.length}`);

  // Build lookup of ALL riders with real ELO
  const richRiders = await sql`
    SELECT r.id, r.name, r.pcs_id, ds.current_elo, ds.uci_points
    FROM rider_discipline_stats ds
    JOIN riders r ON r.id = ds.rider_id
    WHERE ds.discipline = 'road' AND ds.current_elo > 1500
  `;
  
  // Build maps for matching
  const richByPcsId = new Map<string, typeof richRiders[0]>();
  const richByNorm = new Map<string, typeof richRiders[0]>();
  for (const r of richRiders) {
    if (r.pcs_id) richByPcsId.set(r.pcs_id, r);
    richByNorm.set(normalizeName(r.name), r);
  }

  let fixed = 0, notFound = 0;

  for (const entry of noEloRiders) {
    // Try pcs_id match first
    let match = entry.pcs_id ? richByPcsId.get(entry.pcs_id) : null;
    
    // Try normalized name match
    if (!match) {
      match = richByNorm.get(normalizeName(entry.name)) || null;
    }

    if (match && match.id !== entry.rider_id) {
      // Check this rider isn't already in the startlist
      const existing = await sql`
        SELECT id FROM race_startlist WHERE race_id = ${raceId} AND rider_id = ${match.id}
      `;
      if (existing.length > 0) {
        // Delete the current entry (it's a duplicate; the one with real ELO already exists)
        await sql`DELETE FROM race_startlist WHERE id = ${entry.entry_id}`;
        console.log(`  DELETED dup: ${entry.name} (bib ${entry.bib_number}) — real record already in startlist`);
      } else {
        // Update the entry to point to the canonical rider
        await sql`UPDATE race_startlist SET rider_id = ${match.id} WHERE id = ${entry.entry_id}`;
        console.log(`  FIXED: ${entry.name} → ${match.name} (ELO ${match.current_elo})`);
      }
      fixed++;
    } else if (!match) {
      notFound++;
    }
  }

  console.log(`  Fixed: ${fixed}, Not found: ${notFound}`);

  // Verify final count and ELO distribution
  const [finalCount] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${raceId}`;
  const [withElo] = await sql`
    SELECT count(*) FROM race_startlist rs
    JOIN rider_discipline_stats ds ON ds.rider_id = rs.rider_id AND ds.discipline = 'road'
    WHERE rs.race_id = ${raceId} AND ds.current_elo > 1500
  `;
  console.log(`  Final: ${finalCount.count} riders, ${withElo.count} with ELO > 1500`);
}

async function main() {
  await fixRace(MEN_RACE, "Men's Omloop");
  await fixRace(WOMEN_RACE, "Women's Omloop");
  console.log('\n✅ Done! Now regenerate predictions.');
}

main().catch(console.error).finally(() => process.exit(0));
