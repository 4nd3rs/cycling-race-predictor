import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../../src/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import * as cheerio from "cheerio";
import * as fs from "fs";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const { races, raceStartlist, riders, teams, riderDisciplineStats } = schema;

const RACE_ID = "d2264df3-e2c1-4109-810c-0e7e8833801c"; // junior-men race

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

async function main() {
  const TOKEN = "ad2aaefc1bf54040b26b4cdc9f477f7792fa8b9ca31";
  const url = "https://www.procyclingstats.com/race/kuurne-brussel-kuurne-juniors/2026/startlist";

  console.log("Fetching startlist via scrape.do...");
  const res = await fetch(`https://api.scrape.do?token=${TOKEN}&url=${encodeURIComponent(url)}&render=true`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`scrape.do ${res.status}`);
  const html = await res.text();

  const $ = cheerio.load(html);

  type RawEntry = { riderName: string; riderPcsId: string; teamName: string | null; bibNumber: number | null };
  const rawEntries: RawEntry[] = [];

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

  // Deduplicate
  const seen = new Set<string>();
  const entries = rawEntries.filter(e => {
    if (!e.riderPcsId || seen.has(e.riderPcsId)) return false;
    seen.add(e.riderPcsId);
    return true;
  });

  console.log(`Found ${entries.length} riders`);

  let inserted = 0;
  for (const entry of entries) {
    try {
      const teamId = entry.teamName ? await findOrCreateTeam(entry.teamName) : null;
      const riderId = await findOrCreateRider(entry.riderName, entry.riderPcsId, teamId!);

      const existing = await db.query.raceStartlist.findFirst({
        where: and(eq(raceStartlist.raceId, RACE_ID), eq(raceStartlist.riderId, riderId)),
      });
      if (existing) continue;

      await db.insert(raceStartlist).values({
        raceId: RACE_ID,
        riderId,
        teamId: teamId || undefined,
        bibNumber: entry.bibNumber || undefined,
      });

      // Ensure discipline stats
      const existingStats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(riderDisciplineStats.riderId, riderId),
          eq(riderDisciplineStats.discipline, "road"),
          eq(riderDisciplineStats.ageCategory, "junior"),
        ),
      });
      if (!existingStats) {
        await db.insert(riderDisciplineStats).values({
          riderId,
          discipline: "road",
          ageCategory: "junior",
          gender: "men",
          currentElo: "1500",
          eloMean: "1500",
          eloVariance: "350",
          uciPoints: 0,
        }).onConflictDoNothing();
      }

      inserted++;
      console.log(`  + ${entry.riderName} (${entry.teamName || "no team"})`);
    } catch (err: any) {
      console.error(`  ! ${entry.riderName}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${inserted} riders inserted into startlist`);
}

main().catch(console.error);
