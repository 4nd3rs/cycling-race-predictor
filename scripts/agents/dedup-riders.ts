/**
 * dedup-riders.ts
 * Finds riders that are the same person but stored under reversed name order,
 * merges them into the canonical record (older/richer one), and deletes the duplicate.
 *
 * Usage:
 *   tsx scripts/agents/dedup-riders.ts            # dry run
 *   tsx scripts/agents/dedup-riders.ts --apply    # actually merge
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });
const APPLY = process.argv.includes("--apply");
const DISCIPLINE = process.argv.find(a => a.startsWith("--discipline="))?.split("=")[1] ?? null;

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(stripAccents(name).split(/\s+/));
}

function sameTokens(a: string, b: string): boolean {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

async function main() {
  console.log(`🔍 Dedup riders — mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // Load all riders
  const allRiders = await sqlClient`
    SELECT id, name, nationality, birth_date as "birthDate",
           photo_url as "photoUrl", bio, instagram_handle as "instagramHandle",
           created_at as "createdAt"
    FROM riders
  ` as Array<{ id: string; name: string; nationality: string | null; birthDate: string | null; photoUrl: string | null; bio: string | null; instagramHandle: string | null; createdAt: Date }>;

  console.log(`Loaded ${allRiders.length} riders`);

  // Build duplicate pairs: same token set, different name string
  const pairs: Array<{ keep: typeof allRiders[0]; discard: typeof allRiders[0] }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < allRiders.length; i++) {
    const a = allRiders[i];
    if (seen.has(a.id)) continue;

    for (let j = i + 1; j < allRiders.length; j++) {
      const b = allRiders[j];
      if (seen.has(b.id)) continue;
      if (stripAccents(a.name) === stripAccents(b.name)) continue; // same name, different issue
      if (!sameTokens(a.name, b.name)) continue;

      // They're the same person with reversed name order
      // Keep the one with more data (photo/bio/team) or older createdAt
      const aScore = (a.photoUrl ? 2 : 0) + (a.bio ? 2 : 0) + (a.nationality ? 1 : 0) + (a.instagramHandle ? 1 : 0);
      const bScore = (b.photoUrl ? 2 : 0) + (b.bio ? 2 : 0) + (b.nationality ? 1 : 0) + (b.instagramHandle ? 1 : 0);
      
      // Also prefer properly-cased name over ALL_CAPS last name
      const aHasCaps = /^[A-Z]{2,}/.test(a.name);
      const bHasCaps = /^[A-Z]{2,}/.test(b.name);
      const aFinalScore = aScore + (aHasCaps ? -1 : 0);
      const bFinalScore = bScore + (bHasCaps ? -1 : 0);

      const [keep, discard] = aFinalScore >= bFinalScore
        ? [a, b]
        : [b, a];

      pairs.push({ keep, discard });
      seen.add(discard.id);
    }
  }

  console.log(`Found ${pairs.length} duplicate pairs\n`);
  
  if (pairs.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const { keep, discard } of pairs) {
    console.log(`  KEEP:    ${keep.name} (${keep.id.substring(0,8)})`);
    console.log(`  DISCARD: ${discard.name} (${discard.id.substring(0,8)})`);

    if (!APPLY) { console.log(""); continue; }

    // Re-point all foreign key references from discard → keep
    const tables: Array<{ table: any; col: any; label: string }> = [
      { table: schema.raceStartlist, col: schema.raceStartlist.riderId, label: "race_startlist" },
      { table: schema.raceResults, col: schema.raceResults.riderId, label: "race_results" },
      { table: schema.predictions, col: schema.predictions.riderId, label: "predictions" },
      { table: schema.riderDisciplineStats, col: schema.riderDisciplineStats.riderId, label: "rider_discipline_stats" },
      { table: schema.riderRumours, col: schema.riderRumours.riderId, label: "rider_rumours" },
    ];

    for (const { table, col, label } of tables) {
      try {
        await db.update(table).set({ riderId: keep.id } as any).where(eq(col, discard.id));
        // Note: on-conflict-do-nothing isn't available here for composite PKs;
        // DB constraints (unique) may cause errors — we catch and continue
      } catch (e: any) {
        // Duplicate key on composite PK (e.g. same race + same rider after re-point)
        if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
          // Already has a row for keep.id — delete the discard row instead
          try {
            await db.delete(table).where(eq(col, discard.id));
          } catch {}
        }
      }
    }

    // Merge enrichment data into keep if keep is missing it
    const updates: Record<string, any> = {};
    if (!keep.photoUrl && discard.photoUrl) updates.photoUrl = discard.photoUrl;
    if (!keep.bio && discard.bio) updates.bio = discard.bio;
    if (!keep.nationality && discard.nationality) updates.nationality = discard.nationality;
    if (!keep.instagramHandle && discard.instagramHandle) updates.instagramHandle = discard.instagramHandle;
    if (Object.keys(updates).length > 0) {
      await db.update(schema.riders).set(updates).where(eq(schema.riders.id, keep.id));
    }

    // Delete the duplicate
    await db.delete(schema.riders).where(eq(schema.riders.id, discard.id));
    console.log(`  ✅ Merged → ${keep.name}\n`);
  }

  if (!APPLY) {
    console.log(`\nRun with --apply to merge ${pairs.length} pairs`);
  } else {
    console.log(`\n✅ Merged ${pairs.length} pairs`);
  }
}

main().catch(console.error);
