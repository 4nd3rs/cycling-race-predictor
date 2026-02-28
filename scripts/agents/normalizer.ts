/**
 * normalizer.ts — Data normalizer for cycling-race-predictor DB
 * Usage: tsx scripts/agents/normalizer.ts [--dry-run] [--fix races|countries|predictions|riders|all]
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fixIdx = args.indexOf("--fix");
const FIX = fixIdx !== -1 ? args[fixIdx + 1] : "all";

const COUNTRY_MAP: Record<string, string | null> = {
  DNK: "DEN", DEU: "GER", NLD: "NED", PRT: "POR", CHE: "SUI", HRV: "CRO", SVN: "SLO",
  "***": null, "EE ": "EST", EE: "EST",
  Norway: "NOR", Sweden: "SWE", Spain: "ESP", France: "FRA", Italy: "ITA",
  Germany: "GER", Switzerland: "SUI", Netherlands: "NED", Belgium: "BEL",
  Denmark: "DEN", "United States": "USA", "United Kingdom": "GBR", Poland: "POL",
  "Czech Republic": "CZE", Czechia: "CZE", Australia: "AUS", Canada: "CAN",
  Colombia: "COL", Slovenia: "SLO", Croatia: "CRO", Portugal: "POR", Austria: "AUT",
  Slovakia: "SVK", Finland: "FIN", Hungary: "HUN", Romania: "ROU", Russia: "RUS",
  Ukraine: "UKR", Thailand: "THA", Turkey: "TUR", Serbia: "SRB",
  "South Korea": "KOR", Korea: "KOR", Japan: "JPN", China: "CHN", Brazil: "BRA",
  Argentina: "ARG", Mexico: "MEX", "South Africa": "RSA", "New Zealand": "NZL",
  Israel: "ISR", Kazakhstan: "KAZ", Luxembourg: "LUX", Ireland: "IRL", Greece: "GRE",
  Lithuania: "LTU", Latvia: "LAT", Estonia: "EST", Bulgaria: "BUL", Belarus: "BLR",
  Eritrea: "ERI", Ethiopia: "ETH", Cuba: "CUB", Ecuador: "ECU", Peru: "PER",
  Chile: "CHI", Venezuela: "VEN", Namibia: "NAM", Andorra: "AND", Albania: "ALB",
  Algeria: "ALG", Bolivia: "BOL", Cyprus: "CYP", "Dominican Republic": "DOM",
  Guam: "GUM", Guatemala: "GUA", India: "IND", Philippines: "PHI",
  "Puerto Rico": "PUR", "Costa Rica": "CRC", Singapore: "SIN", Bermuda: "BER",
};

let summary = { racesInspected: 0, racesMerged: 0, countriesFixed: 0, predictionsRemoved: 0, ridersInspected: 0, ridersMerged: 0 };

async function fixDuplicateRaces() {
  console.log("\n🔧 [1/4] Fixing duplicate races...");
  const groups = await sql`
    SELECT race_event_id, category_slug, array_agg(id) as ids, COUNT(*) as cnt
    FROM races GROUP BY race_event_id, category_slug HAVING COUNT(*) > 1
  `;
  console.log(`  Found ${groups.length} groups with duplicates`);
  summary.racesInspected = groups.length;

  for (const group of groups) {
    const ids: string[] = group.ids;
    // Score each candidate
    const scored = await Promise.all(ids.map(async (id) => {
      const rows = await sql`
        SELECT
          (SELECT COUNT(*) FROM race_results WHERE race_id = ${id}) * 10 +
          (SELECT COUNT(*) FROM race_startlist WHERE race_id = ${id}) * 2 +
          (SELECT COUNT(*) FROM predictions WHERE race_id = ${id}) * 3 +
          CASE WHEN pcs_url IS NOT NULL THEN 5 ELSE 0 END as score,
          updated_at, created_at
        FROM races WHERE id = ${id}
      `;
      return { id, score: Number(rows[0].score), updated_at: rows[0].updated_at, created_at: rows[0].created_at };
    }));
    scored.sort((a, b) => b.score !== a.score ? b.score - a.score :
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const winner = scored[0];
    const losers = scored.slice(1).map(s => s.id);
    console.log(`  event=${group.race_event_id.slice(0,8)} cat=${group.category_slug}: keep=${winner.id.slice(0,8)} (score=${winner.score}), remove ${losers.length}`);

    if (!DRY_RUN) {
      for (const loserId of losers) {
        // race_results: delete conflicts first, then update the rest
        await sql`DELETE FROM race_results WHERE race_id = ${loserId} AND rider_id IN (SELECT rider_id FROM race_results WHERE race_id = ${winner.id})`;
        await sql`UPDATE race_results SET race_id = ${winner.id} WHERE race_id = ${loserId}`;
        // race_startlist: same
        await sql`DELETE FROM race_startlist WHERE race_id = ${loserId} AND rider_id IN (SELECT rider_id FROM race_startlist WHERE race_id = ${winner.id})`;
        await sql`UPDATE race_startlist SET race_id = ${winner.id} WHERE race_id = ${loserId}`;
        // predictions: same
        await sql`DELETE FROM predictions WHERE race_id = ${loserId} AND rider_id IN (SELECT rider_id FROM predictions WHERE race_id = ${winner.id})`;
        await sql`UPDATE predictions SET race_id = ${winner.id} WHERE race_id = ${loserId}`;
        // race_news
        try { await sql`UPDATE race_news SET race_id = ${winner.id} WHERE race_id = ${loserId}`; } catch {}
        await sql`DELETE FROM races WHERE id = ${loserId}`;
        summary.racesMerged++;
      }
    }
  }
  console.log(DRY_RUN ? `  [DRY RUN] Would merge ${groups.length} groups` : `  ✅ Merged ${summary.racesMerged} race rows`);
}

async function fixCountries() {
  console.log("\n🌍 [2/4] Normalizing country codes...");
  let fixed = 0;
  for (const [from, to] of Object.entries(COUNTRY_MAP)) {
    const [r] = await sql`SELECT COUNT(*) as cnt FROM riders WHERE nationality = ${from}`;
    if (Number(r.cnt) > 0) {
      console.log(`  riders: ${from} → ${to ?? "NULL"} (${r.cnt})`);
      if (!DRY_RUN) {
        if (to === null) await sql`UPDATE riders SET nationality = NULL WHERE nationality = ${from}`;
        else await sql`UPDATE riders SET nationality = ${to} WHERE nationality = ${from}`;
        fixed += Number(r.cnt);
      }
    }
    const [e] = await sql`SELECT COUNT(*) as cnt FROM race_events WHERE country = ${from}`;
    if (Number(e.cnt) > 0) {
      console.log(`  race_events: ${from} → ${to ?? "NULL"} (${e.cnt})`);
      if (!DRY_RUN) {
        if (to === null) await sql`UPDATE race_events SET country = NULL WHERE country = ${from}`;
        else await sql`UPDATE race_events SET country = ${to} WHERE country = ${from}`;
        fixed += Number(e.cnt);
      }
    }
  }
  summary.countriesFixed = fixed;
  console.log(DRY_RUN ? `  [DRY RUN] Would fix country codes` : `  ✅ Fixed ${fixed} entries`);
}

async function fixDuplicatePredictions() {
  console.log("\n🔮 [3/4] Fixing duplicate predictions...");
  // Delete all but the best prediction per race+rider in one SQL statement
  const result = await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY race_id, rider_id ORDER BY confidence_score DESC NULLS LAST, created_at DESC) as rn
      FROM predictions
    )
    ${DRY_RUN ? sql`SELECT COUNT(*) as cnt FROM ranked WHERE rn > 1` : sql`DELETE FROM predictions WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`}
  `;
  const cnt = DRY_RUN ? Number(result[0]?.cnt ?? 0) : result.length;
  summary.predictionsRemoved = cnt;
  console.log(DRY_RUN ? `  [DRY RUN] Would remove ${cnt} duplicate predictions` : `  ✅ Removed ${cnt} duplicate predictions`);
}

async function fixDuplicateRiders() {
  console.log("\n👤 [4/4] Fixing duplicate riders...");
  const groups = await sql`
    SELECT LOWER(TRIM(name)) as norm_name, nationality, array_agg(id) as ids, COUNT(*) as cnt
    FROM riders WHERE name IS NOT NULL
    GROUP BY LOWER(TRIM(name)), nationality HAVING COUNT(*) > 1
  `;
  console.log(`  Found ${groups.length} duplicate rider groups`);
  summary.ridersInspected = groups.length;

  for (const group of groups) {
    const ids: string[] = group.ids;
    const scored = await Promise.all(ids.map(async (id) => {
      const rows = await sql`
        SELECT
          (SELECT COUNT(*) FROM race_results WHERE rider_id = ${id}) * 10 +
          (SELECT COUNT(*) FROM race_startlist WHERE rider_id = ${id}) * 2 +
          (SELECT COUNT(*) FROM predictions WHERE rider_id = ${id}) * 3 +
          CASE WHEN pcs_id IS NOT NULL THEN 5 ELSE 0 END +
          CASE WHEN bio IS NOT NULL THEN 3 ELSE 0 END +
          CASE WHEN photo_url IS NOT NULL THEN 2 ELSE 0 END as score
        FROM riders WHERE id = ${id}
      `;
      return { id, score: Number(rows[0].score) };
    }));
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const losers = scored.slice(1).map(s => s.id);
    console.log(`  "${group.norm_name}" (${group.nationality ?? "?"}): keep=${winner.id.slice(0,8)} score=${winner.score} remove=${losers.length}`);
    if (!DRY_RUN) {
      for (const loserId of losers) {
        await sql`DELETE FROM race_results WHERE rider_id = ${loserId} AND race_id IN (SELECT race_id FROM race_results WHERE rider_id = ${winner.id})`;
        await sql`UPDATE race_results SET rider_id = ${winner.id} WHERE rider_id = ${loserId}`;
        await sql`DELETE FROM race_startlist WHERE rider_id = ${loserId} AND race_id IN (SELECT race_id FROM race_startlist WHERE rider_id = ${winner.id})`;
        await sql`UPDATE race_startlist SET rider_id = ${winner.id} WHERE rider_id = ${loserId}`;
        await sql`DELETE FROM predictions WHERE rider_id = ${loserId} AND race_id IN (SELECT race_id FROM predictions WHERE rider_id = ${winner.id})`;
        await sql`UPDATE predictions SET rider_id = ${winner.id} WHERE rider_id = ${loserId}`;
        try { await sql`UPDATE elo_ratings SET rider_id = ${winner.id} WHERE rider_id = ${loserId}`; } catch {}
        await sql`DELETE FROM riders WHERE id = ${loserId}`;
        summary.ridersMerged++;
      }
    }
  }
  console.log(DRY_RUN ? `  [DRY RUN] Would merge riders` : `  ✅ Merged ${summary.ridersMerged} rider rows`);
}

async function main() {
  console.log(`\n🧹 Normalizer [${DRY_RUN ? "DRY RUN" : "LIVE"}] fix=${FIX}`);
  const runAll = FIX === "all";
  if (runAll || FIX === "races") await fixDuplicateRaces();
  if (runAll || FIX === "countries") await fixCountries();
  if (runAll || FIX === "predictions") await fixDuplicatePredictions();
  if (runAll || FIX === "riders") await fixDuplicateRiders();

  console.log("\n📊 Summary:");
  console.log(`  Duplicate race groups:  ${summary.racesInspected} found, ${summary.racesMerged} rows removed`);
  console.log(`  Country codes fixed:    ${summary.countriesFixed}`);
  console.log(`  Duplicate predictions:  ${summary.predictionsRemoved} removed`);
  console.log(`  Duplicate rider groups: ${summary.ridersInspected} found, ${summary.ridersMerged} rows removed`);
  if (DRY_RUN) console.log("\n  ⚠️  DRY RUN — no changes written");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
