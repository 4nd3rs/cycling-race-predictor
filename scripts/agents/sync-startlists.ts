/**
 * Sync Startlists Agent
 *
 * Scrapes full startlists from ProCyclingStats for all upcoming races
 * that have a pcsUrl set. Finds/creates riders and teams, upserts startlist.
 *
 * Usage: npx tsx scripts/agents/sync-startlists.ts [--race-id <uuid>]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, gte, and, isNotNull, ilike, or } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const raceIdArg = args[args.indexOf("--race-id") + 1] || null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function findOrCreateTeam(name: string): Promise<string> {
  const existing = await db.query.teams.findFirst({
    where: ilike(schema.teams.name, name),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.teams)
    .values({ name, discipline: "road" })
    .returning({ id: schema.teams.id });
  return created.id;
}

async function findOrCreateRider(
  name: string,
  pcsId: string | null,
  teamId: string
): Promise<string> {
  // Try pcsId first
  if (pcsId) {
    const byPcsId = await db.query.riders.findFirst({
      where: eq(schema.riders.pcsId, pcsId),
    });
    if (byPcsId) {
      await db.update(schema.riders).set({ teamId }).where(eq(schema.riders.id, byPcsId.id));
      return byPcsId.id;
    }
  }

  // Try exact name match
  const byName = await db.query.riders.findFirst({
    where: ilike(schema.riders.name, name),
  });
  if (byName) {
    await db.update(schema.riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(schema.riders.id, byName.id));
    return byName.id;
  }

  // Try accent-stripped name match
  const allRiders = await db.select({ id: schema.riders.id, name: schema.riders.name })
    .from(schema.riders)
    .limit(5000);
  const stripped = stripAccents(name);
  const match = allRiders.find(r => stripAccents(r.name) === stripped);
  if (match) {
    await db.update(schema.riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(schema.riders.id, match.id));
    return match.id;
  }

  // Create new rider
  const [created] = await db
    .insert(schema.riders)
    .values({ name, pcsId: pcsId || undefined, teamId })
    .returning({ id: schema.riders.id });
  return created.id;
}

// ─── Discipline Stats Helper ─────────────────────────────────────────────────

async function ensureDisciplineStats(
  riderId: string,
  discipline: string,
  ageCategory: string,
  gender: string
) {
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(schema.riderDisciplineStats.riderId, riderId),
      eq(schema.riderDisciplineStats.discipline, discipline),
      eq(schema.riderDisciplineStats.ageCategory, ageCategory)
    ),
  });
  if (!existing) {
    await db
      .insert(schema.riderDisciplineStats)
      .values({
        riderId,
        discipline,
        ageCategory,
        gender,
        currentElo: "1500",
        eloMean: "1500",
        eloVariance: "350",
        uciPoints: 0,
      })
      .onConflictDoNothing();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function syncStartlistForRace(race: { id: string; name: string; pcsUrl: string | null }) {
  if (!race.pcsUrl) {
    console.log(`⏭️  ${race.name}: no pcsUrl, skipping`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  // Load full race details for discipline stats
  const fullRace = await db.query.races.findFirst({
    where: eq(schema.races.id, race.id),
  });
  const raceDiscipline = fullRace?.discipline || "road";
  const raceAgeCategory = fullRace?.ageCategory || "elite";
  const raceGender = fullRace?.gender || "men";

  // Build startlist URL from pcs race url
  const startlistUrl = race.pcsUrl.replace(/\/$/, "") + "/startlist";
  console.log(`\n🔍 ${race.name}`);
  console.log(`   URL: ${startlistUrl}`);

  // Use Playwright to bypass Cloudflare on PCS
  let html: string;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto(startlistUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for startlist content
    await page.waitForSelector(".startlist_v4, table.basic, .ridersCont", { timeout: 10000 }).catch(() => {});
    html = await page.content();
  } catch (err: any) {
    await browser.close();
    console.error(`   ❌ Playwright fetch failed: ${err.message}`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  await browser.close();

  // Parse startlist from HTML using cheerio (same logic as pcs.ts scrapeStartlist)
  const $ = cheerio.load(html);
  const entries: Array<{ riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null }> = [];

  // Method 1: Team-based startlist (.startlist_v4)
  $(".startlist_v4 > li").each((_, teamEl) => {
    const teamName = $(teamEl).find("b, .team-name, h3").first().text().trim() || null;
    $(teamEl).find(".ridersCont li, ul li").each((_, riderEl) => {
      const link = $(riderEl).find("a[href*='/rider/']").first();
      const riderName = link.text().trim();
      const href = link.attr("href") || "";
      const riderPcsId = href.split("/rider/")[1]?.split("/")[0]?.split("?")[0] || "";
      const bib = parseInt($(riderEl).find(".bib, .nr").text().trim()) || null;
      if (riderName && riderPcsId) {
        entries.push({ riderName, riderPcsId, teamName, bibNumber: bib });
      }
    });
  });

  // Method 2: Flat list if method 1 failed
  if (entries.length === 0) {
    $("a[href*='/rider/']").each((_, el) => {
      const riderName = $(el).text().trim();
      const href = $(el).attr("href") || "";
      const riderPcsId = href.split("/rider/")[1]?.split("/")[0] || "";
      if (riderName && riderPcsId && riderName.length > 2 && riderName.length < 60) {
        const teamEl = $(el).closest("li, tr").find("a[href*='/team/']").first();
        const teamName = teamEl.text().trim() || null;
        entries.push({ riderName, riderPcsId, teamName, bibNumber: null });
      }
    });
  }

  // Deduplicate by pcsId
  const seen = new Set<string>();
  const unique = entries.filter(e => {
    if (seen.has(e.riderPcsId)) return false;
    seen.add(e.riderPcsId);
    return true;
  });

  if (unique.length === 0) {
    console.log(`   ⚠️  No entries found in HTML`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  console.log(`   📋 Found ${unique.length} riders`);
  const entries2 = unique;

  console.log(`   📋 Found ${entries.length} riders`);

  let inserted = 0, updated = 0, errors = 0;

  for (const entry of entries2) {
    try {
      const teamId = entry.teamName
        ? await findOrCreateTeam(entry.teamName)
        : null;

      const riderId = await findOrCreateRider(
        entry.riderName,
        entry.riderPcsId || null,
        teamId!
      );

      // Check if already in startlist
      const existing = await db.query.raceStartlist.findFirst({
        where: and(
          eq(schema.raceStartlist.raceId, race.id),
          eq(schema.raceStartlist.riderId, riderId)
        ),
      });

      if (!existing) {
        await db.insert(schema.raceStartlist).values({
          raceId: race.id,
          riderId,
          teamId: teamId || undefined,
          bibNumber: entry.bibNumber || undefined,
        });
        inserted++;
      } else {
        // Update bib/team if changed
        if (entry.bibNumber && existing.bibNumber !== entry.bibNumber) {
          await db.update(schema.raceStartlist)
            .set({ teamId: teamId || undefined, bibNumber: entry.bibNumber || undefined })
            .where(eq(schema.raceStartlist.id, existing.id));
          updated++;
        }
      }

      // Ensure rider has discipline stats for this race
      await ensureDisciplineStats(riderId, raceDiscipline, raceAgeCategory, raceGender);
    } catch (err: any) {
      console.error(`   ❌ ${entry.riderName}: ${err.message}`);
      errors++;
    }
  }

  console.log(`   ✅ ${inserted} inserted, ${updated} updated, ${errors} errors`);
  return { inserted, updated, skipped: entries2.length - inserted - updated - errors };
}

async function main() {
  const today = new Date().toISOString().split("T")[0];

  let races;
  if (raceIdArg) {
    races = await db.query.races.findMany({
      where: eq(schema.races.id, raceIdArg),
    });
  } else {
    // All active upcoming races (next 30 days) with a pcsUrl
    const thirtyDaysOut = new Date();
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
    const maxDate = thirtyDaysOut.toISOString().split("T")[0];

    races = await db.query.races.findMany({
      where: and(
        eq(schema.races.status, "active"),
        gte(schema.races.date, today),
        isNotNull(schema.races.pcsUrl)
      ),
    });
  }

  if (races.length === 0) {
    console.log("No upcoming races with pcsUrl found.");
    process.exit(0);
  }

  console.log(`Found ${races.length} race(s) to sync startlists for:\n`);
  races.forEach(r => console.log(`  • ${r.name} (${r.date})`));

  let totalInserted = 0, totalUpdated = 0;

  for (const race of races) {
    const result = await syncStartlistForRace(race);
    totalInserted += result.inserted;
    totalUpdated += result.updated;
  }

  console.log(`\n📊 Total: ${totalInserted} new riders, ${totalUpdated} updated across ${races.length} race(s)`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
