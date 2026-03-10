import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  db,
  races,
  raceStartlist,
  riders,
  riderDisciplineStats,
  raceEvents,
  startlistEvents,
} from "@/lib/db";
import { eq, gte, lte, and, asc, notExists, isNull } from "drizzle-orm";
import { findOrCreateRider, findOrCreateTeam } from "@/lib/riders/find-or-create";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";

export const maxDuration = 60;

const MAX_RACES = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureDisciplineStats(
  riderId: string,
  discipline: string,
  ageCategory: string,
  gender: string
) {
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(riderDisciplineStats.riderId, riderId),
      eq(riderDisciplineStats.discipline, discipline),
      eq(riderDisciplineStats.ageCategory, ageCategory)
    ),
  });
  if (!existing) {
    await db
      .insert(riderDisciplineStats)
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

// ── Sync one race ─────────────────────────────────────────────────────────────

async function syncStartlistForRace(race: {
  id: string;
  name: string;
  pcsUrl: string | null;
  discipline: string | null;
  ageCategory: string | null;
  gender: string | null;
  raceEventId: string | null;
}): Promise<{ inserted: number; updated: number; errors: number }> {
  if (!race.pcsUrl) return { inserted: 0, updated: 0, errors: 0 };

  // Women's races must have a women's PCS URL — never scrape a men's page for women.
  // Women's PCS URLs always contain one of these indicators in the slug.
  const WOMENS_SLUG_INDICATORS = ["-we", "-donne", "-femmes", "-women", "-ladies", "-fem", "-vrouwen", "-femenina", "-feminine"];
  const raceGender = race.gender || "men";
  if (raceGender === "women") {
    const slugPart = race.pcsUrl.replace("https://www.procyclingstats.com/race/", "").split("/")[0];
    const isWomensUrl = WOMENS_SLUG_INDICATORS.some(ind => slugPart.includes(ind));
    if (!isWomensUrl) {
      console.warn("[sync-startlists] Skipping " + race.name + " — pcs_url looks like a men's page (" + slugPart + "). Fix pcs_url to use women's PCS slug.");
      return { inserted: 0, updated: 0, errors: 0 };
    }
  }

  const startlistUrl = race.pcsUrl.replace(/\/$/, "") + "/startlist";
  const raceDiscipline = race.discipline || "road";
  const raceAgeCategory = race.ageCategory || "elite";

  type RawEntry = { riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null };
  let rawEntries: RawEntry[] = [];

  try {
    const html = await scrapeDo(startlistUrl);
    const $ = cheerio.load(html);

    // Method 1: Team-based .startlist_v4
    $(".startlist_v4 > li").each((_, teamEl) => {
      const teamNameEl = $(teamEl).find("a.team[href*='team/'], b, .team-name, h3").first();
      const teamName = teamNameEl.text().trim().replace(/\s*\(WT\)|\s*\(PRT\)|\s*\(CT\)/gi, "").trim() || null;
      $(teamEl).find(".ridersCont li, ul li").each((__, riderEl) => {
        const link = $(riderEl).find("a[href*='rider/']").first();
        if (!link.length) return;
        const riderName = link.text().trim();
        const href = link.attr("href") || "";
        const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0]?.split("?")[0] || "";
        const bibText = $(riderEl).find(".bib, .nr").text().trim();
        const bib = bibText ? parseInt(bibText) || null : null;
        if (riderName && riderPcsId) rawEntries.push({ riderName, riderPcsId, teamName, bibNumber: bib });
      });
    });

    // Method 2: flat fallback
    if (rawEntries.length === 0) {
      $("a[href*='rider/']").each((_, el) => {
        const riderName = $(el).text().trim();
        const href = $(el).attr("href") || "";
        const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0] || "";
        if (riderName && riderPcsId && riderName.length > 2 && riderName.length < 60) {
          const teamName = $(el).closest("li, tr").find("a[href*='team/']").first().text().trim() || null;
          rawEntries.push({ riderName, riderPcsId, teamName, bibNumber: null });
        }
      });
    }
  } catch (err: any) {
    console.error(`[sync-startlists] scrape.do failed for ${race.name}: ${err.message}`);
    return { inserted: 0, updated: 0, errors: 1 };
  }

  // Deduplicate by pcsId
  const seen = new Set<string>();
  const entries = rawEntries.filter(e => {
    if (!e.riderPcsId || seen.has(e.riderPcsId)) return false;
    seen.add(e.riderPcsId);
    return true;
  });

  if (entries.length === 0) return { inserted: 0, updated: 0, errors: 0 };

  let inserted = 0, updated = 0, errors = 0;
  const newRiderIds: string[] = [];

  for (const entry of entries) {
    try {
      const team = entry.teamName ? await findOrCreateTeam(entry.teamName, "road") : null;
      const teamId = team?.id ?? null;
      const rider = await findOrCreateRider({ name: entry.riderName, pcsId: entry.riderPcsId || null, teamId });
      const riderId = rider.id;

      const existingByRider = await db.query.raceStartlist.findFirst({
        where: and(eq(raceStartlist.raceId, race.id), eq(raceStartlist.riderId, riderId)),
      });

      if (!entry.bibNumber && existingByRider) continue;

      if (entry.bibNumber) {
        const existingByBib = await db.query.raceStartlist.findFirst({
          where: and(eq(raceStartlist.raceId, race.id), eq(raceStartlist.bibNumber, entry.bibNumber)),
        });
        if (existingByBib && existingByBib.riderId !== riderId) {
          if (existingByRider) {
            await db.update(raceStartlist)
              .set({ teamId: teamId || undefined, bibNumber: entry.bibNumber })
              .where(eq(raceStartlist.id, existingByRider.id));
            await db.delete(raceStartlist).where(eq(raceStartlist.id, existingByBib.id));
          } else {
            await db.update(raceStartlist)
              .set({ riderId, teamId: teamId || undefined })
              .where(eq(raceStartlist.id, existingByBib.id));
          }
          updated++;
          await ensureDisciplineStats(riderId, raceDiscipline, raceAgeCategory, raceGender);
          continue;
        }
      }

      if (!existingByRider) {
        await db.insert(raceStartlist).values({
          raceId: race.id,
          riderId,
          teamId: teamId || undefined,
          bibNumber: entry.bibNumber || undefined,
        });
        inserted++;
        newRiderIds.push(riderId);
        // Write startlist event for notification system
        await db.insert(startlistEvents).values({
          raceId: race.id,
          riderId,
          eventType: "added",
        }).onConflictDoNothing().catch(() => {});
      } else {
        const bibChanged = entry.bibNumber && existingByRider.bibNumber !== entry.bibNumber;
        const teamMissing = teamId && !existingByRider.teamId;
        if (bibChanged || teamMissing) {
          await db.update(raceStartlist)
            .set({ teamId: teamId || undefined, bibNumber: entry.bibNumber || undefined })
            .where(eq(raceStartlist.id, existingByRider.id));
          updated++;
        }
      }

      await ensureDisciplineStats(riderId, raceDiscipline, raceAgeCategory, raceGender);
    } catch (err: any) {
      errors++;
    }
  }

  return { inserted, updated, errors };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const refreshMaxDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Find upcoming races that have a pcsUrl but no startlist entries yet
    // Skip stages (parentRaceId != null) — stages inherit the parent's startlist
    const racesToSync = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.status, "active"),
          gte(races.date, today),
          lte(races.date, maxDate),
          isNull(races.parentRaceId),
          notExists(
            db.select({ id: raceStartlist.id })
              .from(raceStartlist)
              .where(eq(raceStartlist.raceId, races.id))
          )
        )
      )
      .orderBy(asc(races.date))
      .limit(MAX_RACES);

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let totalRemoved = 0;

    for (const race of racesToSync) {
      const result = await syncStartlistForRace(race);
      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalErrors += result.errors;
    }

    // Re-sync races within 3 days that already have startlists (detect removals)
    // Only if we have budget left (max 1 refresh per run to stay within 60s)
    if (racesToSync.length < MAX_RACES) {
      const racesToRefresh = await db
        .select()
        .from(races)
        .where(
          and(
            eq(races.status, "active"),
            gte(races.date, today),
            lte(races.date, refreshMaxDate),
            isNull(races.parentRaceId),
          )
        )
        .orderBy(asc(races.date))
        .limit(1);

      for (const race of racesToRefresh) {
        if (!race.pcsUrl) continue;
        // Track existing rider IDs before re-sync
        const beforeIds = new Set(
          (await db.select({ riderId: raceStartlist.riderId })
            .from(raceStartlist)
            .where(eq(raceStartlist.raceId, race.id))
          ).map(r => r.riderId)
        );
        if (beforeIds.size === 0) continue; // Skip if no existing startlist

        const result = await syncStartlistForRace(race);
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalErrors += result.errors;

        // After re-sync, check for removals by comparing scraped riders to DB
        // The scraped riders are the ones now in the DB, so we check if any beforeIds are gone
        const afterIds = new Set(
          (await db.select({ riderId: raceStartlist.riderId })
            .from(raceStartlist)
            .where(eq(raceStartlist.raceId, race.id))
          ).map(r => r.riderId)
        );
        for (const riderId of beforeIds) {
          if (!afterIds.has(riderId)) {
            await db.insert(startlistEvents).values({
              raceId: race.id,
              riderId,
              eventType: "removed",
            }).onConflictDoNothing().catch(() => {});
            totalRemoved++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      racesProcessed: racesToSync.length,
      totalInserted,
      totalUpdated,
      totalErrors,
      totalRemoved,
    });
  } catch (error) {
    console.error("[cron/sync-startlists]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
