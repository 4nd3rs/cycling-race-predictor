/**
 * dedup-riders-sql.ts — fast SQL-based dedup
 * Finds duplicate riders (same tokens, different order) and merges them.
 * Usage: tsx scripts/agents/dedup-riders-sql.ts [--apply]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`🔍 Rider dedup — ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // Find all pairs with same token set but different name string
  // We decide: keep the one with more data, then prefer proper-case over ALLCAPS/reversed
  const pairs = await sql`
    SELECT
      a.id as aid, a.name as aname,
      b.id as bid, b.name as bname,
      CASE
        WHEN (a.photo_url IS NOT NULL OR a.bio IS NOT NULL OR a.team_id IS NOT NULL)
          AND (b.photo_url IS NULL AND b.bio IS NULL AND b.team_id IS NULL)
          THEN 'a'
        WHEN (b.photo_url IS NOT NULL OR b.bio IS NOT NULL OR b.team_id IS NOT NULL)
          AND (a.photo_url IS NULL AND a.bio IS NULL AND a.team_id IS NULL)
          THEN 'b'
        -- Prefer name that's NOT all-uppercase first word (PCS "MAXWELL Samara" → b)
        WHEN a.name ~ '^[A-Z]{3,}' AND NOT b.name ~ '^[A-Z]{3,}' THEN 'b'
        WHEN b.name ~ '^[A-Z]{3,}' AND NOT a.name ~ '^[A-Z]{3,}' THEN 'a'
        -- Prefer proper title-case Firstname Lastname (UCI format)
        WHEN a.name ~ '^[A-Z][a-z]' THEN 'a'
        ELSE 'b'
      END as keep_which,
      a.photo_url as aphoto, b.photo_url as bphoto,
      a.bio as abio, b.bio as bbio
    FROM riders a
    JOIN riders b ON a.id < b.id
    WHERE array_to_string(
        ARRAY(SELECT unnest(string_to_array(lower(a.name), ' ')) ORDER BY 1), ' ')
      = array_to_string(
        ARRAY(SELECT unnest(string_to_array(lower(b.name), ' ')) ORDER BY 1), ' ')
    ORDER BY aname
  `;

  console.log(`Found ${pairs.length} duplicate pairs\n`);
  if (pairs.length === 0) { console.log("Nothing to do."); return; }

  // Build keep/discard mapping
  const merges: Array<{ keepId: string; keepName: string; discardId: string; discardName: string }> = pairs.map((p: any) => ({
    keepId:      p.keep_which === "a" ? p.aid : p.bid,
    keepName:    p.keep_which === "a" ? p.aname : p.bname,
    discardId:   p.keep_which === "a" ? p.bid : p.aid,
    discardName: p.keep_which === "a" ? p.bname : p.aname,
  }));

  for (const m of merges) {
    console.log(`  KEEP    ${m.keepName.padEnd(40)} (${m.keepId.substring(0,8)})`);
    console.log(`  DISCARD ${m.discardName.padEnd(40)} (${m.discardId.substring(0,8)})\n`);
  }

  if (!APPLY) {
    console.log(`\nRun with --apply to merge ${merges.length} pairs`);
    return;
  }

  console.log("Merging...\n");

  let done = 0;
  for (const { keepId, keepName, discardId } of merges) {
    try {
      // Re-point FK refs — handle duplicates by deleting the old row
      // race_startlist has unique(race_id, rider_id) — delete discard rows that would conflict
      await sql`
        DELETE FROM race_startlist
        WHERE rider_id = ${discardId}
          AND race_id IN (SELECT race_id FROM race_startlist WHERE rider_id = ${keepId})
      `;
      await sql`UPDATE race_startlist SET rider_id = ${keepId} WHERE rider_id = ${discardId}`;

      await sql`
        DELETE FROM race_results
        WHERE rider_id = ${discardId}
          AND race_id IN (SELECT race_id FROM race_results WHERE rider_id = ${keepId})
      `;
      await sql`UPDATE race_results SET rider_id = ${keepId} WHERE rider_id = ${discardId}`;

      await sql`
        DELETE FROM predictions
        WHERE rider_id = ${discardId}
          AND race_id IN (SELECT race_id FROM predictions WHERE rider_id = ${keepId})
      `;
      await sql`UPDATE predictions SET rider_id = ${keepId} WHERE rider_id = ${discardId}`;

      // rider_discipline_stats: merge by keeping the row with more data
      await sql`
        DELETE FROM rider_discipline_stats
        WHERE rider_id = ${discardId}
          AND (discipline, age_category, gender) IN (
            SELECT discipline, age_category, gender
            FROM rider_discipline_stats WHERE rider_id = ${keepId}
          )
      `;
      await sql`UPDATE rider_discipline_stats SET rider_id = ${keepId} WHERE rider_id = ${discardId}`;

      await sql`DELETE FROM rider_rumours WHERE rider_id = ${discardId}`;

      // Merge enrichment data if keep is missing it
      await sql`
        UPDATE riders r SET
          photo_url = COALESCE(r.photo_url, d.photo_url),
          bio = COALESCE(r.bio, d.bio),
          nationality = COALESCE(r.nationality, d.nationality),
          instagram_handle = COALESCE(r.instagram_handle, d.instagram_handle),
          team_id = COALESCE(r.team_id, d.team_id),
          pcs_id = COALESCE(r.pcs_id, d.pcs_id),
          uci_id = COALESCE(r.uci_id, d.uci_id),
          xco_id = COALESCE(r.xco_id, d.xco_id),
          wiki_slug = COALESCE(r.wiki_slug, d.wiki_slug),
          pcs_url = COALESCE(r.pcs_url, d.pcs_url)
        FROM riders d
        WHERE r.id = ${keepId} AND d.id = ${discardId}
      `;

      // Delete the duplicate
      await sql`DELETE FROM riders WHERE id = ${discardId}`;
      console.log(`  ✅ ${keepName}`);
      done++;
    } catch (e: any) {
      console.error(`  ❌ ${keepName}: ${e.message?.substring(0,100)}`);
    }
  }

  console.log(`\n✅ Merged ${done}/${merges.length} pairs`);
}

main().catch(console.error);
