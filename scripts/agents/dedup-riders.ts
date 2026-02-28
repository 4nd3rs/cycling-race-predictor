import { config } from 'dotenv'; config({ path: '.env.local' });
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import * as schema from '../../src/lib/db/schema';

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Canonical key: sorted lowercase words, accent-stripped
function canonicalKey(name: string): string {
  const stripped = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return stripped.toLowerCase().split(/\s+/).sort().join(" ");
}

// Canonical "First Last" from any order name
function toFirstLast(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  // Detect ALL_CAPS last name (UCI format: LASTNAME Firstname)
  const stripAcc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let lastCapIdx = -1;
  for (let i = 0; i < words.length - 1; i++) {
    const w = stripAcc(words[i]);
    if (w === w.toUpperCase() && w.length > 1 && /[A-Za-z]/.test(w)) {
      lastCapIdx = i;
    } else break;
  }
  if (lastCapIdx >= 0) {
    const last = words.slice(0, lastCapIdx + 1);
    const first = words.slice(lastCapIdx + 1);
    return [...first, ...last].map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  // Title case as-is
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

async function main() {
  const allRiders = await db.select().from(schema.riders);
  console.log(`Total riders: ${allRiders.length}`);

  // Group by canonical key (sorted words, accent-stripped)
  const byKey = new Map<string, typeof allRiders>();
  for (const r of allRiders) {
    const key = canonicalKey(r.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  const dupeGroups = [...byKey.values()].filter(g => g.length > 1);
  console.log(`Found ${dupeGroups.length} duplicate groups to merge`);

  let merged = 0;
  for (const group of dupeGroups) {
    // Rank: most results wins; ties broken by pcsId > xcoId > uciId
    const withCounts = await Promise.all(group.map(async r => {
      const [res] = await db.select({ cnt: drizzleSql<number>`count(*)::int` })
        .from(schema.raceResults).where(eq(schema.raceResults.riderId, r.id));
      return { ...r, resultCount: res.cnt };
    }));
    withCounts.sort((a, b) => {
      if (b.resultCount !== a.resultCount) return b.resultCount - a.resultCount;
      if (a.pcsId && !b.pcsId) return -1;
      if (!a.pcsId && b.pcsId) return 1;
      if (a.xcoId && !b.xcoId) return -1;
      if (!a.xcoId && b.xcoId) return 1;
      return 0;
    });

    const canonical = withCounts[0];
    const dupes = withCounts.slice(1);
    const normName = toFirstLast(canonical.name);

    // Clear IDs on dupes first to avoid unique violations
    for (const d of dupes) {
      await db.update(schema.riders).set({ pcsId: null, xcoId: null, uciId: null })
        .where(eq(schema.riders.id, d.id));
    }

    // Backfill missing IDs to canonical
    const updates: Record<string, unknown> = { name: normName };
    for (const d of dupes) {
      if (d.pcsId && !canonical.pcsId) updates.pcsId = d.pcsId;
      if (d.xcoId && !canonical.xcoId) updates.xcoId = d.xcoId;
      if (d.uciId && !canonical.uciId) updates.uciId = d.uciId;
      if (d.nationality && !canonical.nationality) updates.nationality = d.nationality;
      if (d.birthDate && !canonical.birthDate) updates.birthDate = d.birthDate;
    }
    await db.update(schema.riders).set(updates).where(eq(schema.riders.id, canonical.id));

    // Reroute results + elo_history
    for (const d of dupes) {
      const dupeResults = await db.select({ id: schema.raceResults.id, raceId: schema.raceResults.raceId })
        .from(schema.raceResults).where(eq(schema.raceResults.riderId, d.id));

      for (const res of dupeResults) {
        // Check for conflict
        const conflict = await db.query.raceResults.findFirst({
          where: eq(schema.raceResults.riderId, canonical.id),
        });
        if (!conflict) {
          await db.update(schema.raceResults).set({ riderId: canonical.id })
            .where(eq(schema.raceResults.id, res.id));
        } else {
          await db.delete(schema.raceResults).where(eq(schema.raceResults.id, res.id));
        }
      }
      await db.update(schema.eloHistory).set({ riderId: canonical.id })
        .where(eq(schema.eloHistory.riderId, d.id));
      await db.delete(schema.riders).where(eq(schema.riders.id, d.id));
    }

    const totalResults = withCounts.reduce((s, r) => s + r.resultCount, 0);
    if (totalResults > 0 || dupes.some(d => d.name !== canonical.name)) {
      console.log(`  ✓ "${group.map(r=>r.name).join('" + "')}" → "${normName}" (${totalResults} results)`);
    }
    merged++;
  }
  console.log(`\n✅ Done: merged ${merged} duplicate groups`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
