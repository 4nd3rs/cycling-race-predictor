/**
 * seed-road-elo.ts
 *
 * Seeds initial ELO for road riders based on UCI ranking points.
 * Road riders have no historical race data in our system yet, so we use
 * UCI points as a proxy for starting ELO.
 *
 * Formula: ELO = 1500 + (uciPoints / maxPoints) * 400
 *   → Top rider (e.g. 4000 pts) ≈ 1900
 *   → 1000 pts ≈ 1600
 *   → 0 pts → 1500 (default)
 *
 * Run: node_modules/.bin/tsx scripts/agents/seed-road-elo.ts [--dry-run] [--category elite|u23]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { db, riderDisciplineStats } from '../../src/lib/db';
import { eq, and, gt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

const DRY_RUN  = process.argv.includes('--dry-run');
const CAT_FLAG = process.argv.find(a => !a.startsWith('--') && a !== process.argv[1] && a !== 'node_modules/.bin/tsx' && a !== 'scripts/agents/seed-road-elo.ts');
const CATEGORY = CAT_FLAG || 'all';

async function run() {
  // Get all road discipline stats that have UCI points
  const rows = await db
    .select()
    .from(riderDisciplineStats)
    .where(
      and(
        eq(riderDisciplineStats.discipline, 'road'),
        gt(riderDisciplineStats.uciPoints, 0)
      )
    );

  console.log(`\n📊 Road riders with UCI points: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No road riders with UCI points found. Run sync-road-uci.ts first.');
    process.exit(0);
  }

  // Find max UCI points to normalize
  const maxPoints = Math.max(...rows.map(r => r.uciPoints || 0));
  console.log(`🏆 Max UCI points in DB: ${maxPoints}`);

  // We anchor against a realistic max (5000 pts = world #1 level)
  // Use whichever is larger to avoid over-scaling
  const anchor = Math.max(maxPoints, 3500);

  let updated = 0;

  for (const row of rows) {
    const uciPts = row.uciPoints || 0;

    // Seed ELO: 1500 base + up to +400 based on UCI points
    const seededElo = Math.round(1500 + (uciPts / anchor) * 400);
    const eloVariance = Math.max(150, 350 - Math.round((uciPts / anchor) * 150));
    // Higher-ranked riders have lower variance (more predictable)

    console.log(`  ${row.ageCategory}/${row.gender} — UCI ${uciPts} → ELO ${seededElo} (±${Math.sqrt(eloVariance).toFixed(0)}σ)`);

    if (!DRY_RUN) {
      await db.update(riderDisciplineStats)
        .set({
          currentElo: seededElo.toString(),
          eloMean:    seededElo.toString(),
          eloVariance: eloVariance.toString(),
        })
        .where(eq(riderDisciplineStats.id, row.id));
      updated++;
    }
  }

  // For road riders with 0 UCI points but existing stats, keep at 1500
  const zeroPts = await db
    .select({ c: sql<number>`count(*)` })
    .from(riderDisciplineStats)
    .where(
      and(
        eq(riderDisciplineStats.discipline, 'road'),
        eq(riderDisciplineStats.uciPoints, 0)
      )
    );
  console.log(`\n📋 Riders at default ELO 1500 (0 UCI pts): ${zeroPts[0]?.c || 0}`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no changes written');
  } else {
    console.log(`\n✅ Updated ELO for ${updated} riders`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
