/**
 * /api/cron/scrape-mtb-results
 * Scrapes MTB XCO results from xcodata.com.
 * Runs every 6h. Covers last 7 days of races.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, races, raceResults, riderDisciplineStats } from "@/lib/db";
import { riders } from "@/lib/db/schema";
import { and, eq, gte, lte, or, isNull, ne } from "drizzle-orm";
import * as cheerio from "cheerio";
import { processRaceElo } from "@/lib/prediction/process-race-elo";

export const maxDuration = 300;

const DISCORD_CHANNEL = "1476643255243509912";
const DAYS_BACK = 7;

// ── Auth & Discord ─────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

async function postToDiscord(msg: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });
  } catch {}
}

// ── XCOdata fetch ──────────────────────────────────────────────────────────────

async function fetchXCO(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 3000));
      return fetchXCO(url, attempt + 1);
    }
    throw e;
  }
}

// ── XCOdata race list ──────────────────────────────────────────────────────────

interface XCOEntry { xcoId: string; name: string; date: string }

function parseXCODate(raw: string): string {
  const clean = raw.trim().replace(/.*-\s*/, "").trim();
  const m = clean.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return "";
  const months: Record<string, string> = { Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12" };
  return `${m[3]}-${months[m[2]] ?? "01"}-${m[1].padStart(2, "0")}`;
}

let xcoListCache: XCOEntry[] | null = null;

async function getXCOList(): Promise<XCOEntry[]> {
  if (xcoListCache) return xcoListCache;
  const html = await fetchXCO("https://www.xcodata.com/races");
  const $ = cheerio.load(html);
  const entries: XCOEntry[] = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const date = parseXCODate(cells.eq(0).text().trim());
    if (!date) return;
    const link = $(row).find("a[href*='/race/']").first();
    const xcoId = link.attr("href")?.match(/\/race\/(\d+)\//)?.[1] ?? "";
    const name = link.text().trim();
    if (xcoId && name && date) entries.push({ xcoId, name, date });
  });
  xcoListCache = entries;
  return entries;
}

function normalizeForMatch(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

async function findXCORaceId(race: { name: string; date: string }): Promise<string | null> {
  const list = await getXCOList();
  const cleanName = normalizeForMatch(race.name.replace(/\s*[-–|]\s*(elite|u23|under 23|junior|men|women).*$/i, "").trim());
  const raceDateMs = new Date(race.date).getTime();
  let best: { xcoId: string; score: number } | null = null;

  for (const entry of list) {
    const daysDiff = Math.abs((new Date(entry.date).getTime() - raceDateMs) / 86400000);
    if (daysDiff > 3) continue;
    const entryName = normalizeForMatch(entry.name);
    const raceTokens = new Set(cleanName.split(" ").filter(t => t.length > 2));
    const entryTokens = new Set(entryName.split(" ").filter(t => t.length > 2));
    let overlap = 0;
    for (const t of raceTokens) if (entryTokens.has(t)) overlap++;
    const score = overlap / Math.max(raceTokens.size, 1) * (1 - daysDiff * 0.05);
    if (score > 0.4 && (!best || score > best.score)) best = { xcoId: entry.xcoId, score };
  }

  return best?.xcoId ?? null;
}

// ── Parse XCOdata results ──────────────────────────────────────────────────────

interface XCOResult { position: number | null; riderName: string; timeSeconds: number | null; dnf: boolean; dns: boolean; catCode: string }

const CAT_MAP: Record<string, { ageCategory: string; gender: string }> = {
  XCO_ME: { ageCategory: "elite",  gender: "men" },   XCO_WE: { ageCategory: "elite",  gender: "women" },
  XCO_MU: { ageCategory: "u23",    gender: "men" },   XCO_WU: { ageCategory: "u23",    gender: "women" },
  XCO_MJ: { ageCategory: "junior", gender: "men" },   XCO_WJ: { ageCategory: "junior", gender: "women" },
  XCC_ME: { ageCategory: "elite",  gender: "men" },   XCC_WE: { ageCategory: "elite",  gender: "women" },
};

function parseXCORiderName(raw: string): string {
  const words = raw.replace(/\s+/g, " ").trim().split(" ");
  let nameEnd = words.length, foundFirst = false;
  for (let i = 1; i < words.length; i++) {
    if (!foundFirst && /^[A-Z][a-z]/.test(words[i])) { foundFirst = true; nameEnd = i + 1; }
    else if (foundFirst && /^[A-Z]{2,}/.test(words[i])) { nameEnd = i; break; }
  }
  return words.slice(0, nameEnd).join(" ");
}

function parseXCOTime(raw: string): number | null {
  const timeOnly = raw.replace(/\d+\s*Pts.*$/i, "").trim();
  if (!timeOnly || timeOnly === "-") return null;
  const parts = timeOnly.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

const xcoPageCache = new Map<string, string>();

async function scrapeXCOResults(xcoId: string): Promise<XCOResult[]> {
  let html = xcoPageCache.get(xcoId) ?? "";
  if (!html) {
    html = await fetchXCO(`https://www.xcodata.com/race/${xcoId}/`);
    xcoPageCache.set(xcoId, html);
  }
  const $ = cheerio.load(html);
  const results: XCOResult[] = [];

  $("table").each((_, tbl) => {
    let catCode = "";
    $(tbl).find("a[href]").each((_, el) => {
      if (catCode) return;
      const m = ($(el).attr("href") ?? "").match(/#laps-\d+-(XC[CO]_\w+)/);
      if (m) catCode = m[1];
    });
    if (!catCode) return;

    $(tbl).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const posText = cells.eq(0).text().trim();
      if (!posText || posText.toLowerCase() === "rank") return;
      const riderRaw = cells.eq(1).text().replace(/\s+/g, " ").trim();
      const riderName = parseXCORiderName(riderRaw);
      if (!riderName || riderName.toLowerCase() === "rider") return;
      const resultRaw = cells.eq(2)?.text().replace(/\s+/g, " ").trim() ?? "";
      const posUp = posText.toUpperCase();
      const isDnf = posUp === "DNF" || resultRaw.toUpperCase().includes("DNF");
      const isDns = posUp === "DNS" || resultRaw.toUpperCase().includes("DNS");
      results.push({ position: isDnf || isDns ? null : parseInt(posText) || null, riderName, timeSeconds: isDnf || isDns ? null : parseXCOTime(resultRaw), dnf: isDnf, dns: isDns, catCode });
    });
  });

  return results;
}

// ── Rider cache & import ──────────────────────────────────────────────────────

let riderCache: Map<string, string> | null = null;

async function getRiderCache(): Promise<Map<string, string>> {
  if (riderCache) return riderCache;
  const all = await db.select({ id: riders.id, name: riders.name }).from(riders).limit(20000);
  riderCache = new Map();
  for (const r of all) {
    const stripped = r.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const norm = stripped.replace(/[^a-z\s]/g, "").trim().split(/\s+/).sort().join(" ");
    riderCache.set(`name:${stripped}`, r.id);
    riderCache.set(`norm:${norm}`, r.id);
  }
  return riderCache;
}

async function findOrCreateRider(name: string): Promise<string> {
  const cache = await getRiderCache();
  const stripped = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (cache.has(`name:${stripped}`)) return cache.get(`name:${stripped}`)!;
  const norm = stripped.replace(/[^a-z\s]/g, "").trim().split(/\s+/).sort().join(" ");
  if (cache.has(`norm:${norm}`)) return cache.get(`norm:${norm}`)!;
  const [created] = await db.insert(riders).values({ name }).returning({ id: riders.id });
  cache.set(`name:${stripped}`, created.id);
  cache.set(`norm:${norm}`, created.id);
  return created.id;
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const pastDate = new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10);

  try {
    const pendingRaces = await db
      .select({ id: races.id, name: races.name, date: races.date, ageCategory: races.ageCategory, gender: races.gender, raceType: races.raceType })
      .from(races)
      .where(and(
        eq(races.discipline, "mtb"),
        gte(races.date, pastDate),
        lte(races.date, today),
        or(isNull(races.status), ne(races.status, "completed")),
      ));

    if (pendingRaces.length === 0) {
      return NextResponse.json({ success: true, message: "No pending MTB races", timestamp: new Date().toISOString() });
    }

    let totalInserted = 0;
    const report: string[] = [];

    for (const race of pendingRaces) {
      const xcoId = await findXCORaceId({ name: race.name, date: race.date });
      if (!xcoId) { report.push(`⏭️ ${race.name} — no XCOdata match`); continue; }

      const allResults = await scrapeXCOResults(xcoId);
      if (!allResults.length) { report.push(`⏳ ${race.name} — no results yet`); continue; }

      const raceType = (race.raceType ?? "xco").toUpperCase().includes("XCC") ? "XCC" : "XCO";
      const ageCategory = race.ageCategory ?? "elite";
      const gender = race.gender ?? "men";
      const ag = ageCategory === "elite" ? "E" : ageCategory === "u23" ? "U" : "J";
      const gn = gender === "men" ? "M" : "W";
      const key = `${raceType}_${gn}${ag}`;

      const catResults = allResults.filter(r => r.catCode === key);
      const toImport = catResults.length > 0 ? catResults : (new Set(allResults.map(r => r.catCode)).size === 1 ? allResults : []);
      if (!toImport.length || toImport.filter(r => !r.dnf && !r.dns).length < 3) {
        report.push(`⏳ ${race.name} — incomplete (${key})`);
        continue;
      }

      // Import results
      const existing = new Set((await db.select({ riderId: raceResults.riderId }).from(raceResults).where(eq(raceResults.raceId, race.id))).map(r => r.riderId));
      let inserted = 0;

      for (const r of toImport) {
        const riderId = await findOrCreateRider(r.riderName);
        if (existing.has(riderId)) continue;
        await db.insert(raceResults).values({ raceId: race.id, riderId, position: r.position, timeSeconds: r.timeSeconds, dnf: r.dnf, dns: r.dns });
        await db.insert(riderDisciplineStats).values({ riderId, discipline: "mtb", ageCategory, gender, eloMean: "1500", eloVariance: "350" }).onConflictDoNothing();
        existing.add(riderId);
        inserted++;
      }

      if (inserted > 0) {
        await db.update(races).set({ status: "completed", updatedAt: new Date() }).where(eq(races.id, race.id));
        try { await processRaceElo(race.id); } catch {}
        totalInserted += inserted;
        report.push(`✅ ${race.name} — ${inserted} results`);
      } else {
        report.push(`✅ ${race.name} — already imported`);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    if (totalInserted > 0) {
      const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
      await postToDiscord(`🚵 MTB Results [${time}] — ${totalInserted} new results\n${report.slice(0, 5).map(r => `• ${r}`).join("\n")}`);
    }

    return NextResponse.json({ success: true, totalInserted, races: report, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/scrape-mtb-results]", error);
    await postToDiscord(`🚵 MTB Results ⚠️ Error: ${String(error).substring(0, 200)}`);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() { return GET(); }
