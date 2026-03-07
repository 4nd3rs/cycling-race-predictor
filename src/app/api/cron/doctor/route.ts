import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, raceStartlist, raceEvents, riders, riderDisciplineStats, predictions } from "@/lib/db";
import { and, eq, lt, gte, lte, isNull, exists, notExists, sql, asc, inArray } from "drizzle-orm";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";
import { neon } from "@neondatabase/serverless";

export const maxDuration = 300;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Discord notification ──────────────────────────────────────────────────────

async function postToDiscord(message: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = "1476643255243509912"; // #pcp-data
  if (!token) { console.warn("[doctor] No DISCORD_BOT_TOKEN set"); return; }
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (e) {
    console.error("[doctor] Discord post failed:", e);
  }
}

// ── Check 1: Duplicate riders ─────────────────────────────────────────────────

async function deduplicateRiders(): Promise<{ pairs: number; deleted: number }> {
  const sqlClient = neon(process.env.DATABASE_URL!);

  const PAIRS_CTE = `WITH pairs AS (
    SELECT
      CASE WHEN (a.photo_url IS NOT NULL OR a.bio IS NOT NULL OR a.team_id IS NOT NULL)
              AND (b.photo_url IS NULL AND b.bio IS NULL AND b.team_id IS NULL) THEN a.id
           WHEN (b.photo_url IS NOT NULL OR b.bio IS NOT NULL OR b.team_id IS NOT NULL)
              AND (a.photo_url IS NULL AND a.bio IS NULL AND a.team_id IS NULL) THEN b.id
           WHEN a.name ~ '^[A-Z]{3,}' AND NOT b.name ~ '^[A-Z]{3,}' THEN b.id
           WHEN b.name ~ '^[A-Z]{3,}' AND NOT a.name ~ '^[A-Z]{3,}' THEN a.id
           WHEN a.name ~ '^[A-Z][a-z]' THEN a.id ELSE b.id END AS keep_id,
      CASE WHEN (a.photo_url IS NOT NULL OR a.bio IS NOT NULL OR a.team_id IS NOT NULL)
              AND (b.photo_url IS NULL AND b.bio IS NULL AND b.team_id IS NULL) THEN b.id
           WHEN (b.photo_url IS NOT NULL OR b.bio IS NOT NULL OR b.team_id IS NOT NULL)
              AND (a.photo_url IS NULL AND a.bio IS NULL AND a.team_id IS NULL) THEN a.id
           WHEN a.name ~ '^[A-Z]{3,}' AND NOT b.name ~ '^[A-Z]{3,}' THEN a.id
           WHEN b.name ~ '^[A-Z]{3,}' AND NOT a.name ~ '^[A-Z]{3,}' THEN b.id
           WHEN a.name ~ '^[A-Z][a-z]' THEN b.id ELSE a.id END AS discard_id
    FROM riders a JOIN riders b ON a.id < b.id
    WHERE array_to_string(ARRAY(SELECT unnest(string_to_array(lower(a.name), ' ')) ORDER BY 1), ' ')
        = array_to_string(ARRAY(SELECT unnest(string_to_array(lower(b.name), ' ')) ORDER BY 1), ' ')
  )`;

  type Row = { n: number };
  const countRes = await sqlClient.query(`${PAIRS_CTE} SELECT COUNT(*)::int as n FROM pairs`) as Row[];
  const pairCount = countRes[0]?.n ?? 0;

  if (pairCount === 0) return { pairs: 0, deleted: 0 };

  // Re-point FK refs
  await sqlClient.query(`${PAIRS_CTE} DELETE FROM race_startlist rs USING pairs p WHERE rs.rider_id = p.discard_id AND EXISTS (SELECT 1 FROM race_startlist rs2 WHERE rs2.race_id = rs.race_id AND rs2.rider_id = p.keep_id)`);
  await sqlClient.query(`${PAIRS_CTE} UPDATE race_startlist rs SET rider_id = p.keep_id FROM pairs p WHERE rs.rider_id = p.discard_id`);

  await sqlClient.query(`${PAIRS_CTE} DELETE FROM race_results rr USING pairs p WHERE rr.rider_id = p.discard_id AND EXISTS (SELECT 1 FROM race_results rr2 WHERE rr2.race_id = rr.race_id AND rr2.rider_id = p.keep_id)`);
  await sqlClient.query(`${PAIRS_CTE} UPDATE race_results rr SET rider_id = p.keep_id FROM pairs p WHERE rr.rider_id = p.discard_id`);

  await sqlClient.query(`${PAIRS_CTE} DELETE FROM predictions pr USING pairs p WHERE pr.rider_id = p.discard_id AND EXISTS (SELECT 1 FROM predictions pr2 WHERE pr2.race_id = pr.race_id AND pr2.rider_id = p.keep_id)`);
  await sqlClient.query(`${PAIRS_CTE} UPDATE predictions pr SET rider_id = p.keep_id FROM pairs p WHERE pr.rider_id = p.discard_id`);

  // Merge stats: upsert best values, then delete discards
  await sqlClient.query(`${PAIRS_CTE}
    INSERT INTO rider_discipline_stats (rider_id, discipline, age_category, gender, uci_points, uci_rank, elo_mean, elo_variance, updated_at)
    SELECT p.keep_id, rds.discipline, rds.age_category, rds.gender,
           MAX(rds.uci_points), MIN(CASE WHEN rds.uci_rank > 0 THEN rds.uci_rank ELSE NULL END),
           MAX(rds.elo_mean), MIN(rds.elo_variance), NOW()
    FROM rider_discipline_stats rds JOIN pairs p ON rds.rider_id = p.discard_id
    GROUP BY p.keep_id, rds.discipline, rds.age_category, rds.gender
    ON CONFLICT (rider_id, discipline, age_category) DO UPDATE SET
      uci_points = GREATEST(EXCLUDED.uci_points, rider_discipline_stats.uci_points),
      uci_rank = LEAST(EXCLUDED.uci_rank, rider_discipline_stats.uci_rank),
      elo_mean = GREATEST(EXCLUDED.elo_mean, rider_discipline_stats.elo_mean),
      updated_at = NOW()`);
  await sqlClient.query(`${PAIRS_CTE} DELETE FROM rider_discipline_stats WHERE rider_id IN (SELECT discard_id FROM pairs)`);

  await sqlClient.query(`${PAIRS_CTE} DELETE FROM rider_rumours WHERE rider_id IN (SELECT discard_id FROM pairs)`);

  // Null out unique IDs on discards before deleting
  await sqlClient.query(`${PAIRS_CTE} UPDATE riders SET xco_id=NULL, pcs_id=NULL, uci_id=NULL WHERE id IN (SELECT discard_id FROM pairs)`);

  // Merge enrichment into keep
  await sqlClient.query(`${PAIRS_CTE}
    UPDATE riders r SET
      photo_url = COALESCE(r.photo_url, d.photo_url),
      bio = COALESCE(r.bio, d.bio),
      nationality = COALESCE(r.nationality, d.nationality),
      instagram_handle = COALESCE(r.instagram_handle, d.instagram_handle),
      team_id = COALESCE(r.team_id, d.team_id),
      wiki_slug = COALESCE(r.wiki_slug, d.wiki_slug),
      pcs_url = COALESCE(r.pcs_url, d.pcs_url)
    FROM (SELECT DISTINCT ON (keep_id) keep_id, discard_id FROM pairs) p
    JOIN riders d ON d.id = p.discard_id
    WHERE r.id = p.keep_id`);

  await sqlClient.query(`${PAIRS_CTE} DELETE FROM riders WHERE id IN (SELECT discard_id FROM pairs)`);

  return { pairs: pairCount, deleted: pairCount };
}

// ── Check 2: Mark stale races as completed ────────────────────────────────────

async function markStaleRaces(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const stale = await db
    .select({ id: races.id })
    .from(races)
    .where(and(
      eq(races.status, "active"),
      lt(races.date, sevenDaysAgo),
      notExists(db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, races.id)))
    ));
  if (stale.length > 0) {
    await db.update(races).set({ status: "completed" }).where(sql`${races.id} = ANY(${stale.map(r => r.id)})`);
  }
  return stale.length;
}

// ── Check 3: Mark races with results as completed ─────────────────────────────

async function markRacesWithResults(): Promise<number> {
  const withResults = await db
    .select({ id: races.id })
    .from(races)
    .where(and(
      eq(races.status, "active"),
      exists(db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, races.id)))
    ));
  if (withResults.length > 0) {
    await db.update(races).set({ status: "completed" }).where(sql`${races.id} = ANY(${withResults.map(r => r.id)})`);
  }
  return withResults.length;
}

// ── Check 4: Missing predictions for upcoming races ───────────────────────────

async function fillMissingPredictions(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const threeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  // Find races in next 3 days with startlists but no predictions
  const needsPreds = await db
    .select({ id: races.id, ageCategory: races.ageCategory, gender: races.gender })
    .from(races)
    .where(and(
      eq(races.status, "active"),
      gte(races.date, today),
      lte(races.date, threeDays),
      exists(db.select({ id: raceStartlist.id }).from(raceStartlist).where(eq(raceStartlist.raceId, races.id))),
      notExists(db.select({ id: predictions.id }).from(predictions).where(eq(predictions.raceId, races.id)))
    ));

  if (needsPreds.length === 0) return 0;

  let generated = 0;
  for (const race of needsPreds) {
    try {
      // Get startlist riders with stats
      const startlist = await db
        .select({
          riderId: raceStartlist.riderId,
          eloMean: riderDisciplineStats.eloMean,
          eloVariance: riderDisciplineStats.eloVariance,
          uciPoints: riderDisciplineStats.uciPoints,
        })
        .from(raceStartlist)
        .leftJoin(riderDisciplineStats, and(
          eq(riderDisciplineStats.riderId, raceStartlist.riderId),
          eq(riderDisciplineStats.ageCategory, race.ageCategory ?? "elite"),
        ))
        .where(eq(raceStartlist.raceId, race.id));

      if (startlist.length === 0) continue;

      // Score riders
      const scored = startlist.map(r => {
        const mu = parseFloat(r.eloMean ?? "1500");
        const uciScore = r.uciPoints ? Math.log(r.uciPoints + 1) / Math.log(3000) : 0;
        const eloScore = (mu - 1000) / 2000;
        const hasElo = mu !== 1500;
        return { riderId: r.riderId, score: hasElo ? eloScore * 0.7 + uciScore * 0.3 : uciScore };
      }).sort((a, b) => b.score - a.score);

      const total = scored.reduce((s, r) => s + Math.max(r.score, 0.001), 0);
      const toInsert = scored.map((r, i) => ({
        raceId: race.id,
        riderId: r.riderId,
        rank: i + 1,
        winProbability: (Math.max(r.score, 0.001) / total).toFixed(6),
        source: "elo" as const,
      }));

      await db.insert(predictions).values(toInsert).onConflictDoNothing();
      generated++;
    } catch (e) {
      console.error(`[doctor] predictions error for race ${race.id}:`, e);
    }
  }

  return generated;
}

// ── Check 5: Backfill PCS URLs ────────────────────────────────────────────────

async function backfillPcsUrls(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const missingPcs = await db
    .select({ id: races.id, name: races.name, raceEventId: races.raceEventId })
    .from(races)
    .where(and(
      eq(races.status, "active"),
      eq(races.discipline, "road"),
      isNull(races.pcsUrl),
      gte(races.date, today),
      lte(races.date, cutoff)
    ))
    .limit(20);

  if (missingPcs.length === 0) return 0;

  let pcsRaces: Array<{ name: string; pcsUrl: string }> = [];
  try {
    const html = await scrapeDo("https://www.procyclingstats.com/races.php");
    const $ = cheerio.load(html);
    $("table tbody tr").each((_, row) => {
      const link = $(row).find("a[href*='/race/']").first();
      const href = link.attr("href") ?? "";
      const name = link.text().trim();
      if (!name || !href) return;
      const pcsUrl = href.startsWith("http") ? href : `https://www.procyclingstats.com/${href.replace(/^\//, "")}`;
      pcsRaces.push({ name, pcsUrl });
    });
  } catch { return 0; }

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();

  let backfilled = 0;
  for (const race of missingPcs) {
    const norm = normalize(race.name);
    const match = pcsRaces.find(p => {
      const pn = normalize(p.name);
      return pn === norm || pn.includes(norm) || norm.includes(pn);
    });
    if (match) {
      await db.update(races).set({ pcsUrl: match.pcsUrl }).where(eq(races.id, race.id));
      backfilled++;
    }
  }
  return backfilled;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const alerts: string[] = [];
  const fixes: Record<string, number> = {};

  try {
    // 1. Duplicate rider cleanup
    const { pairs, deleted } = await deduplicateRiders();
    fixes.duplicatesFixed = deleted;
    if (pairs > 10) alerts.push(`🔧 Deduped ${pairs} rider pairs`);

    // 2. Race status
    fixes.staleCompleted = await markStaleRaces();
    fixes.resultsCompleted = await markRacesWithResults();

    // 3. Missing predictions
    fixes.predictionsGenerated = await fillMissingPredictions();
    if (fixes.predictionsGenerated > 0) alerts.push(`🔮 Generated predictions for ${fixes.predictionsGenerated} races`);

    // 4. PCS URL backfill
    fixes.pcsUrlsBackfilled = await backfillPcsUrls();

    // Post to Discord if anything notable happened
    if (alerts.length > 0) {
      const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
      await postToDiscord(`🩺 Data Doctor [${time}]\n${alerts.join("\n")}`);
    }

    return NextResponse.json({ success: true, fixes, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/doctor]", error);
    await postToDiscord(`🩺 Data Doctor ⚠️ Error: ${String(error).substring(0, 200)}`);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
