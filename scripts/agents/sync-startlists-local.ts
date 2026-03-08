/**
 * Local version of sync-startlists that avoids Vercel timeout.
 * Syncs startlists for upcoming road races that have PCS URLs.
 */
import { db, races, raceStartlist, riders, teams, riderDisciplineStats, raceEvents } from "./lib/db";
import { eq, gte, lte, and, ilike, asc, isNotNull } from "drizzle-orm";
import * as cheerio from "cheerio";

const TOKEN = "ad2aaefc1bf54040b26b4cdc9f477f7792fa8b9ca31";

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "").trim().split(/\s+/).sort().join(" ");
}

async function findOrCreateTeam(name: string): Promise<string> {
  const existing = await db.query.teams.findFirst({ where: ilike(teams.name, name) });
  if (existing) return existing.id;
  const [created] = await db.insert(teams).values({ name, discipline: "road" }).returning({ id: teams.id });
  return created.id;
}

async function findOrCreateRider(name: string, pcsId: string | null, teamId: string): Promise<string> {
  if (pcsId) {
    const byPcsId = await db.query.riders.findFirst({ where: eq(riders.pcsId, pcsId) });
    if (byPcsId) {
      await db.update(riders).set({ teamId }).where(eq(riders.id, byPcsId.id));
      return byPcsId.id;
    }
  }
  const byName = await db.query.riders.findFirst({ where: ilike(riders.name, name) });
  if (byName) {
    await db.update(riders).set({ teamId, ...(pcsId ? { pcsId } : {}) }).where(eq(riders.id, byName.id));
    return byName.id;
  }
  const allRiders = await db.select({ id: riders.id, name: riders.name }).from(riders).limit(5000);
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
  const [created] = await db.insert(riders).values({ name, pcsId: pcsId || undefined, teamId }).returning({ id: riders.id });
  return created.id;
}

async function syncRace(race: { id: string; name: string; pcsUrl: string; discipline: string; ageCategory: string | null; gender: string | null }) {
  const startlistUrl = race.pcsUrl.replace(/\/$/, "") + "/startlist";
  console.log(`\nSyncing: ${race.name}`);
  console.log(`  URL: ${startlistUrl}`);

  let html: string;
  try {
    const scrapeUrl = `https://api.scrape.do?token=${TOKEN}&url=${encodeURIComponent(startlistUrl)}&render=true`;
    const res = await fetch(scrapeUrl, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) { console.log(`  scrape.do error: ${res.status}`); return; }
    html = await res.text();
  } catch (err: any) {
    console.log(`  Fetch failed: ${err.message}`);
    return;
  }
  const $ = cheerio.load(html);

  type RawEntry = { riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null };
  const rawEntries: RawEntry[] = [];

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

  const seen = new Set<string>();
  const entries = rawEntries.filter(e => {
    if (!e.riderPcsId || seen.has(e.riderPcsId)) return false;
    seen.add(e.riderPcsId); return true;
  });

  console.log(`  Found ${entries.length} riders`);
  if (entries.length === 0) return;

  let inserted = 0, skipped = 0;
  for (const entry of entries) {
    try {
      const teamId = entry.teamName ? await findOrCreateTeam(entry.teamName) : null;
      const riderId = await findOrCreateRider(entry.riderName, entry.riderPcsId, teamId as string);
      const existing = await db.query.raceStartlist.findFirst({
        where: and(eq(raceStartlist.raceId, race.id), eq(raceStartlist.riderId, riderId)),
      });
      if (existing) { skipped++; continue; }
      await db.insert(raceStartlist).values({
        raceId: race.id, riderId, teamId: teamId || undefined, bibNumber: entry.bibNumber || undefined,
      });
      const existingStats = await db.query.riderDisciplineStats.findFirst({
        where: and(eq(riderDisciplineStats.riderId, riderId), eq(riderDisciplineStats.discipline, race.discipline), eq(riderDisciplineStats.ageCategory, race.ageCategory || "elite")),
      });
      if (!existingStats) {
        await db.insert(riderDisciplineStats).values({
          riderId, discipline: race.discipline, ageCategory: race.ageCategory || "elite",
          gender: race.gender || "men", currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
        }).onConflictDoNothing();
      }
      inserted++;
    } catch (err: any) {
      console.log(`  Error: ${entry.riderName}: ${err.message}`);
    }
  }
  console.log(`  Inserted: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const upcomingRaces = await db.select({
    id: races.id, name: races.name, pcsUrl: races.pcsUrl,
    discipline: races.discipline, ageCategory: races.ageCategory, gender: races.gender,
  }).from(races)
    .where(and(eq(races.status, "active"), gte(races.date, today), lte(races.date, maxDate), isNotNull(races.pcsUrl)))
    .orderBy(asc(races.date));

  const toSync = upcomingRaces.filter(r => r.pcsUrl);
  console.log(`Found ${toSync.length} races with PCS URLs to sync`);

  for (const race of toSync) {
    await syncRace(race as any);
  }
}

main().catch(console.error);
