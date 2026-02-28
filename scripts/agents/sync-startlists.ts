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
import { eq, gte, lte, and, isNotNull, ilike, or, asc } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { writeScrapeStatus, type RaceRow } from "./lib/scrape-status";
import { notifyRiderFollowers, getRaceEventInfo } from "./lib/notify-followers";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const raceIdArgIdx = args.indexOf("--race-id");
const raceIdArg = raceIdArgIdx !== -1 ? args[raceIdArgIdx + 1] || null : null;
const limitArg = parseInt(args[args.indexOf("--limit") + 1] || "8", 10);
const daysAheadArg = parseInt(args[args.indexOf("--days") + 1] || "30", 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/).sort().join(" "); // sort words so "van der poel mathieu" = "mathieu van der poel"
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

  // Try accent-stripped name match, then normalized (word-order-independent) match
  const allRiders = await db.select({ id: schema.riders.id, name: schema.riders.name })
    .from(schema.riders)
    .limit(5000);
  const stripped = stripAccents(name);
  const match = allRiders.find(r => stripAccents(r.name) === stripped);
  if (match) {
    await db.update(schema.riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(schema.riders.id, match.id));
    return match.id;
  }

  // Try normalized match (handles "VAN DER POEL Mathieu" vs "Mathieu van der Poel")
  const normalized = normalizeName(name);
  const normalizedMatch = allRiders.find(r => normalizeName(r.name) === normalized);
  if (normalizedMatch) {
    await db.update(schema.riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(schema.riders.id, normalizedMatch.id));
    return normalizedMatch.id;
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

  // Use Playwright to bypass Cloudflare on PCS — extract via DOM eval, not raw HTML
  type RawEntry = { riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null };
  let rawEntries: RawEntry[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto(startlistUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.waitForSelector(".startlist_v4, .ridersCont", { timeout: 10000 }).catch(() => {});

    // Extract directly from live DOM to avoid cheerio/serialization issues
    rawEntries = await page.evaluate(() => {
      const entries: { riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null }[] = [];

      // Method 1: Team-based .startlist_v4
      // Note: PCS uses relative hrefs ("rider/slug") — match with href*="rider/" not "/rider/"
      const teamEls = document.querySelectorAll(".startlist_v4 > li");
      teamEls.forEach((teamEl) => {
        // PCS team name is in <a class="team" href="team/..."> (second link, first is jersey img)
        const teamNameEl = teamEl.querySelector("a.team[href*='team/'], b, .team-name, h3");
        const teamName = teamNameEl?.textContent?.trim()?.replace(/\s*\(WT\)|\s*\(PRT\)|\s*\(CT\)/gi, '').trim() || null;
        teamEl.querySelectorAll(".ridersCont li, ul li").forEach((riderEl) => {
          const link = riderEl.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
          if (!link) return;
          const riderName = link.textContent?.trim() || "";
          const href = link.getAttribute("href") || "";
          const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0]?.split("?")[0] || "";
          const bibEl = riderEl.querySelector(".bib, .nr");
          const bib = bibEl ? parseInt(bibEl.textContent?.trim() || "") || null : null;
          if (riderName && riderPcsId) {
            entries.push({ riderName, riderPcsId, teamName, bibNumber: bib });
          }
        });
      });

      // Method 2: flat rider links if method 1 empty
      if (entries.length === 0) {
        document.querySelectorAll("a[href*='rider/']").forEach((el) => {
          const riderName = el.textContent?.trim() || "";
          const href = el.getAttribute("href") || "";
          const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0] || "";
          if (riderName && riderPcsId && riderName.length > 2 && riderName.length < 60) {
            const teamLink = el.closest("li, tr")?.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
            const teamName = teamLink?.textContent?.trim() || null;
            entries.push({ riderName, riderPcsId, teamName, bibNumber: null });
          }
        });
      }
      return entries;
    });
  } catch (err: any) {
    await browser.close();
    console.error(`   ❌ Playwright fetch failed: ${err.message}`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  await browser.close();

  // Deduplicate by pcsId
  const seen = new Set<string>();
  const entries2 = rawEntries.filter(e => {
    if (!e.riderPcsId || seen.has(e.riderPcsId)) return false;
    seen.add(e.riderPcsId);
    return true;
  });

  if (entries2.length === 0) {
    console.log(`   ⚠️  No entries found in HTML`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  console.log(`   📋 Found ${entries2.length} riders`);

  let inserted = 0, updated = 0, errors = 0;
  const newlyInsertedRiderIds: string[] = [];

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

      // Check if already in startlist by rider
      const existingByRider = await db.query.raceStartlist.findFirst({
        where: and(
          eq(schema.raceStartlist.raceId, race.id),
          eq(schema.raceStartlist.riderId, riderId)
        ),
      });

      // Guard: null-bib entry when rider already exists → skip entirely
      // This prevents the cron from re-adding ghost entries
      if (!entry.bibNumber && existingByRider) {
        continue;
      }

      // If incoming bib is set, check if another row already has this bib for the race
      if (entry.bibNumber) {
        const existingByBib = await db.query.raceStartlist.findFirst({
          where: and(
            eq(schema.raceStartlist.raceId, race.id),
            eq(schema.raceStartlist.bibNumber, entry.bibNumber)
          ),
        });
        if (existingByBib && existingByBib.riderId !== riderId) {
          // Bib collision: another row holds this bib for a different rider.
          // If the correct rider already has their own row, update that row with
          // the bib and delete the stale collision row — avoids unique (raceId, riderId) violation.
          if (existingByRider) {
            await db.update(schema.raceStartlist)
              .set({ teamId: teamId || undefined, bibNumber: entry.bibNumber })
              .where(eq(schema.raceStartlist.id, existingByRider.id));
            await db.delete(schema.raceStartlist)
              .where(eq(schema.raceStartlist.id, existingByBib.id));
          } else {
            // Rider has no existing row — safe to repurpose the collision row
            await db.update(schema.raceStartlist)
              .set({ riderId, teamId: teamId || undefined })
              .where(eq(schema.raceStartlist.id, existingByBib.id));
          }
          updated++;
          await ensureDisciplineStats(riderId, raceDiscipline, raceAgeCategory, raceGender);
          continue;
        }
      }

      if (!existingByRider) {
        await db.insert(schema.raceStartlist).values({
          raceId: race.id,
          riderId,
          teamId: teamId || undefined,
          bibNumber: entry.bibNumber || undefined,
        });
        inserted++;
        newlyInsertedRiderIds.push(riderId);
      } else {
        // Update bib/team if changed or team was previously missing
        const bibChanged = entry.bibNumber && existingByRider.bibNumber !== entry.bibNumber;
        const teamMissing = teamId && !existingByRider.teamId;
        if (bibChanged || teamMissing) {
          await db.update(schema.raceStartlist)
            .set({ teamId: teamId || undefined, bibNumber: entry.bibNumber || undefined })
            .where(eq(schema.raceStartlist.id, existingByRider.id));
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

  // Notify rider followers about startlist addition
  if (newlyInsertedRiderIds.length > 0 && race.raceEventId) {
    const eventInfo = await getRaceEventInfo(race.raceEventId);
    if (eventInfo) {
      const raceUrl = eventInfo.slug
        ? `https://procyclingpredictor.com/races/${eventInfo.discipline}/${eventInfo.slug}`
        : `https://procyclingpredictor.com`;
      for (const riderId of newlyInsertedRiderIds) {
        try {
          const riderRow = await db.query.riders.findFirst({ where: (r, { eq }) => eq(r.id, riderId) });
          if (!riderRow) continue;
          const msg = [
            `📋 <b>${riderRow.name} is starting ${eventInfo.name}!</b>`,
            ``,
            `Your followed rider has been added to the startlist.`,
            ``,
            `👉 <a href="${raceUrl}">Full startlist & predictions on Pro Cycling Predictor</a>`,
          ].join("\n");
          const notified = await notifyRiderFollowers(riderId, msg);
          if (notified > 0) console.log(`   📨 Notified ${notified} follower(s) of ${riderRow.name}`);
        } catch (err) {
          console.error(`   Notification error for rider ${riderId}:`, err);
        }
      }
    }
  }

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
    // Upcoming races within daysAheadArg, ordered by date, capped at limitArg
    const maxDateObj = new Date();
    maxDateObj.setDate(maxDateObj.getDate() + daysAheadArg);
    const maxDate = maxDateObj.toISOString().split("T")[0];

    // Fetch all upcoming races — those with pcsUrl will be scraped via Playwright,
    // those without will be skipped by the scraper (MTB C1/C2 handled by cron agent web search)
    races = await db.query.races.findMany({
      where: and(
        eq(schema.races.status, "active"),
        gte(schema.races.date, today),
        lte(schema.races.date, maxDate),
      ),
      orderBy: (r, { asc }) => [asc(r.date)],
      limit: limitArg,
    });
  }

  if (races.length === 0) {
    console.log("No upcoming races with pcsUrl found.");
    process.exit(0);
  }

  console.log(`Found ${races.length} race(s) to sync startlists for:\n`);
  races.forEach(r => console.log(`  • ${r.name} (${r.date})`));

  let totalInserted = 0, totalUpdated = 0;
  const raceRows: RaceRow[] = [];

  for (const race of races) {
    const result = await syncStartlistForRace(race);
    totalInserted += result.inserted;
    totalUpdated += result.updated;
    const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
    const total = result.inserted + result.updated + result.skipped;
    const rowStatus = !race.pcsUrl
      ? "⏭️ no pcsUrl"
      : total === 0
      ? "⚠️ empty"
      : result.inserted > 0
      ? `✅ +${result.inserted} new`
      : "✅ up to date";
    raceRows.push({ name: race.name, date: race.date ?? "", count: total, status: rowStatus, scrapedAt: now });
  }

  console.log(`\n📊 Total: ${totalInserted} new riders, ${totalUpdated} updated across ${races.length} race(s)`);

  writeScrapeStatus({
    component: "startlists",
    status: totalInserted > 0 || totalUpdated > 0 ? "ok" : "ok",
    summary: `${totalInserted} new riders added, ${totalUpdated} updated across ${races.length} race(s)`,
    raceRows,
  });
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
