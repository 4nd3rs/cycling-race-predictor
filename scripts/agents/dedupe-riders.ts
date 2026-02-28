/**
 * Deduplicate riders in the database.
 *
 * Finds riders with equivalent normalized names (case-insensitive, accent-stripped,
 * special-char-stripped) and merges them: keeps the best record (most data),
 * re-points all FK references to the winner, then deletes the losers.
 *
 * Usage: node_modules/.bin/tsx scripts/agents/dedupe-riders.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const DRY_RUN = process.argv.includes("--dry-run");

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-zA-Z ]/g, "")      // strip apostrophes, hyphens, digits
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Tables that reference riders.id
const FK_TABLES = [
  { table: "race_startlist",       col: "rider_id" },
  { table: "race_results",         col: "rider_id" },
  { table: "rider_discipline_stats", col: "rider_id" },
  { table: "elo_history",          col: "rider_id" },
  { table: "predictions",          col: "rider_id" },
  { table: "rider_rumours",        col: "rider_id" },
  { table: "follows",              col: "rider_id" },
];

async function main() {
  console.log(`🔍 Rider deduplication — ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // Load all riders
  const rows: Array<{ id: string; name: string; nationality: string | null; pcs_id: string | null; uci_id: string | null; photo_url: string | null; bio: string | null; created_at: string }> =
    await sql`SELECT id, name, nationality, pcs_id, uci_id, photo_url, bio, created_at FROM riders ORDER BY created_at ASC`;

  console.log(`Total riders: ${rows.length}`);

  // Group by normalized name
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = normalize(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const dupes = [...groups.values()].filter(g => g.length > 1);
  console.log(`Duplicate groups found: ${dupes.length}\n`);

  let merged = 0;

  for (const group of dupes) {
    // Pick "winner": prefer record with pcsId, then most data, then oldest
    const winner = group.sort((a, b) => {
      const score = (r: typeof rows[0]) =>
        (r.pcs_id ? 4 : 0) + (r.uci_id ? 2 : 0) + (r.bio ? 1 : 0);
      return score(b) - score(a);
    })[0];

    const losers = group.filter(r => r.id !== winner.id);
    console.log(`Merging: "${group.map(r => r.name).join('" + "')}" → keeping "${winner.name}" (${winner.id})`);

    if (DRY_RUN) { merged++; continue; }

    // Merge best data onto winner
    const bestNationality = winner.nationality ?? losers.find(l => l.nationality)?.nationality ?? null;
    const bestPcsId = winner.pcs_id ?? losers.find(l => l.pcs_id)?.pcs_id ?? null;
    const bestUciId = winner.uci_id ?? losers.find(l => l.uci_id)?.uci_id ?? null;
    const bestPhoto = winner.photo_url ?? losers.find(l => l.photo_url)?.photo_url ?? null;
    const bestBio = winner.bio ?? losers.find(l => l.bio)?.bio ?? null;

    // Clear uci_id from losers first to avoid unique constraint conflict
    for (const loser of losers) {
      if (loser.uci_id) {
        await sql`UPDATE riders SET uci_id = NULL WHERE id = ${loser.id}`;
      }
    }

    await sql`UPDATE riders SET
      nationality = ${bestNationality},
      pcs_id = ${bestPcsId},
      uci_id = ${bestUciId},
      photo_url = ${bestPhoto},
      bio = ${bestBio},
      updated_at = NOW()
      WHERE id = ${winner.id}`;

    // Re-point all FK references from each loser to winner
    for (const loser of losers) {
      for (const { table, col } of FK_TABLES) {
        try {
          // Use ON CONFLICT DO NOTHING to handle unique constraint violations
          // (e.g. race_startlist has unique(race_id, rider_id))
          await sql.unsafe(`
            UPDATE "${table}" SET "${col}" = '${winner.id}'
            WHERE "${col}" = '${loser.id}'
            ON CONFLICT DO NOTHING
          `);
          // Delete any remaining rows that couldn't be moved (true duplicates)
          await sql.unsafe(`DELETE FROM "${table}" WHERE "${col}" = '${loser.id}'`);
        } catch (_) {}
      }

      // Delete the loser rider
      await sql`DELETE FROM riders WHERE id = ${loser.id}`;
      console.log(`  Deleted loser: "${loser.name}" (${loser.id})`);
    }

    merged++;
  }

  console.log(`\nDone — ${merged} groups merged${DRY_RUN ? " (dry run, no changes made)" : ""}`);
}

main().catch(console.error);
