import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  raceStartlist,
  riders,
  teams,
  riderDisciplineStats,
  raceEvents,
} from "@/lib/db";
import { eq, gte, lte, and, ilike, asc, notExists } from "drizzle-orm";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";
import { notifyRiderFollowers } from "@/lib/notify-followers";

export const maxDuration = 60;

const MAX_RACES = 2;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/).sort().join(" ");
}

async function findOrCreateTeam(name: string): Promise<string> {
  const existing = await db.query.teams.findFirst({
    where: ilike(teams.name, name),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(teams)
    .values({ name, discipline: "road" })
    .returning({ id: teams.id });
  return created.id;
}

async function findOrCreateRider(
  name: string,
  pcsId: string | null,
  teamId: string
): Promise<string> {
  if (pcsId) {
    const byPcsId = await db.query.riders.findFirst({
      where: eq(riders.pcsId, pcsId),
    });
    if (byPcsId) {
      await db.update(riders).set({ teamId }).where(eq(riders.id, byPcsId.id));
      return byPcsId.id;
    }
  }

  const byName = await db.query.riders.findFirst({
    where: ilike(riders.name, name),
  });
  if (byName) {
    await db.update(riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(riders.id, byName.id));
    return byName.id;
  }

  const allRiders = await db.select({ id: riders.id, name: riders.name })
    .from(riders)
    .limit(5000);
  const stripped = stripAccents(name);
  const match = allRiders.find(r => stripAccents(r.name) === stripped);
  if (match) {
    await db.update(riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(riders.id, match.id));
    return match.id;
  }

  const normalized = normalizeName(name);
  const normalizedMatch = allRiders.find(r => normalizeName(r.name) === normalized);
  if (normalizedMatch) {
    await db.update(riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(riders.id, normalizedMatch.id));
    return normalizedMatch.id;
  }

  const [created] = await db
    .insert(riders)
    .values({ name, pcsId: pcsId || undefined, teamId })
    .returning({ id: riders.id });
  return created.id;
}

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
      console.warn(\`[sync-startlists] Skipping \${race.name} — pcs_url looks like a men's page (\${slugPart}). Fix pcs_url to use women's PCS slug.\`);
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
      const teamId = entry.teamName ? await findOrCreateTeam(entry.teamName) : null;
      const riderId = await findOrCreateRider(entry.riderName, entry.riderPcsId || null, teamId!);

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

  // Notify followers of newly added riders
  if (newRiderIds.length > 0 && race.raceEventId) {
    try {
      const [eventRow] = await db
        .select({ name: raceEvents.name, slug: raceEvents.slug, discipline: raceEvents.discipline })
        .from(raceEvents)
        .where(eq(raceEvents.id, race.raceEventId))
        .limit(1);
      if (eventRow) {
        const raceUrl = eventRow.slug
          ? `https://procyclingpredictor.com/races/${eventRow.discipline}/${eventRow.slug}`
          : `https://procyclingpredictor.com`;
        for (const riderId of newRiderIds) {
          const riderRow = await db.query.riders.findFirst({ where: eq(riders.id, riderId) });
          if (!riderRow) continue;
          const msg = [
            `📋 <b>${riderRow.name} is starting ${eventRow.name}!</b>`,
            ``,
            `Your followed rider has been added to the startlist.`,
            ``,
            `👉 <a href="${raceUrl}">Full startlist & predictions on Pro Cycling Predictor</a>`,
          ].join("\n");
          await notifyRiderFollowers(riderId, msg).catch(() => {});
        }
      }
    } catch {
      // Notification errors are non-fatal
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

    // Find upcoming races that have a pcsUrl but no startlist entries yet
    const racesToSync = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.status, "active"),
          gte(races.date, today),
          lte(races.date, maxDate),
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

    for (const race of racesToSync) {
      const result = await syncStartlistForRace(race);
      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalErrors += result.errors;
    }

    return NextResponse.json({
      success: true,
      racesProcessed: racesToSync.length,
      totalInserted,
      totalUpdated,
      totalErrors,
    });
  } catch (error) {
    console.error("[cron/sync-startlists]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
