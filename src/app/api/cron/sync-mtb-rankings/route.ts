/**
 * /api/cron/sync-mtb-rankings
 *
 * Syncs UCI MTB XCO rankings from dataride.uci.ch (official UCI source).
 * Runs every Tuesday via Vercel cron. Replaces the old dataride.uci.org approach.
 *
 * Flow:
 * 1. GET /iframe/rankings/7 → get session cookie
 * 2. GET /iframe/GetDisciplineSeasons/ → find current seasonId
 * 3. POST /iframe/RankingsDiscipline/ → get all ranking groups
 * 4. For each XCO category, POST /iframe/ObjectRankings/ → full paginated list
 * 5. Match riders by UCI ID / name (token-set) → upsert riderDisciplineStats
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, riderDisciplineStats } from "@/lib/db";
import { riders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";

export const maxDuration = 300;

const BASE = "https://dataride.uci.ch";
const IFRAME_URL = `${BASE}/iframe/rankings/7`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";
const LIMIT = 300;
const DISCORD_CHANNEL = "1476643255243509912";

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Discord ───────────────────────────────────────────────────────────────────

async function postToDiscord(msg: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });
  } catch {}
}

// ── Category matching ─────────────────────────────────────────────────────────

const CATEGORY_MAP: Array<{ parts: string[]; ageCategory: string; gender: string }> = [
  { parts: ["cross-country", "men", "elite"],    ageCategory: "elite",  gender: "men"   },
  { parts: ["cross-country", "women", "elite"],  ageCategory: "elite",  gender: "women" },
  { parts: ["cross-country", "men", "junior"],   ageCategory: "junior", gender: "men"   },
  { parts: ["cross-country", "women", "junior"], ageCategory: "junior", gender: "women" },
  { parts: ["cross-country", "men", "under 23"], ageCategory: "u23",    gender: "men"   },
  { parts: ["cross-country", "women", "under 23"], ageCategory: "u23",  gender: "women" },
];

function matchCategory(groupName: string): { ageCategory: string; gender: string } | null {
  const lower = groupName.toLowerCase();
  for (const cat of CATEGORY_MAP) {
    if (cat.parts.every(part => new RegExp(`\\b${part.replace(/\s+/g, "\\s+")}\\b`).test(lower))) return cat;
  }
  return null;
}

// ── Name matching ─────────────────────────────────────────────────────────────

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findRider(
  name: string,
  uciId: number | null,
  allRiders: { id: string; name: string; uci_id?: string | null }[]
): { id: string; name: string } | undefined {
  if (uciId) {
    const byId = allRiders.find(r => r.uci_id === String(uciId));
    if (byId) return byId;
  }

  const norm = stripAccents(name);
  const parts = norm.split(/\s+/);
  const reversed = [...parts].reverse().join(" ");
  const tokenSet = new Set(parts);

  const exact = allRiders.find(r => stripAccents(r.name) === norm);
  if (exact) return exact;

  const byReversed = allRiders.find(r => stripAccents(r.name) === reversed);
  if (byReversed) return byReversed;

  const byTokenSet = allRiders.filter(r => {
    const rp = stripAccents(r.name).split(/\s+/);
    return rp.length === parts.length && rp.every(t => tokenSet.has(t));
  });
  if (byTokenSet.length === 1) return byTokenSet[0];

  const last = parts[parts.length - 1];
  const first = parts[0];
  const byLast = allRiders.filter(r => {
    const n = stripAccents(r.name);
    return n === last || n.endsWith(" " + last);
  });
  if (byLast.length === 1) return byLast[0];

  const byBoth = allRiders.filter(r => {
    const rp = stripAccents(r.name).split(/\s+/);
    return rp.includes(first) && rp.includes(last);
  });
  if (byBoth.length === 1) return byBoth[0];

  return undefined;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function initSession(): Promise<string> {
  const res = await fetch(IFRAME_URL, {
    headers: { "User-Agent": UA, "Accept": "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [nv] = c.split(";");
    const [n, v] = nv.split("=");
    if (n?.trim() === "asp_uci_tr_sessionId") return `asp_uci_tr_sessionId=${v.trim()}`;
  }
  throw new Error("No session cookie from dataride.uci.ch");
}

async function apiGet(cookie: string, path: string): Promise<unknown> {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA, "Cookie": cookie, "Accept": "application/json", "Referer": IFRAME_URL },
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function apiPost(cookie: string, path: string, body: Record<string, string | number>): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": IFRAME_URL, "Origin": BASE,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))).toString(),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function fetchRanking(cookie: string, rankingId: number, momentId: number, categoryId: number, raceTypeId: number, seasonId: number) {
  const all: Array<{ rank: number; name: string; uciId: number; points: number }> = [];
  let skip = 0;
  const PAGE = 200;

  while (all.length < LIMIT) {
    const data = await apiPost(cookie, "/iframe/ObjectRankings/", {
      rankingId, disciplineId: 7, rankingTypeId: 1,
      take: PAGE, skip, page: Math.floor(skip / PAGE) + 1, pageSize: PAGE,
      "filter[logic]": "and",
      "filter[filters][0][field]": "RaceTypeId", "filter[filters][0][operator]": "eq", "filter[filters][0][value]": raceTypeId,
      "filter[filters][1][field]": "CategoryId",  "filter[filters][1][operator]": "eq", "filter[filters][1][value]": categoryId,
      "filter[filters][2][field]": "SeasonId",    "filter[filters][2][operator]": "eq", "filter[filters][2][value]": seasonId,
      "filter[filters][3][field]": "MomentId",    "filter[filters][3][operator]": "eq", "filter[filters][3][value]": momentId,
    }) as { data?: unknown[] };

    const rows = data?.data ?? [];
    if (!rows.length) break;
    for (const r of rows as Record<string, unknown>[]) {
      all.push({ rank: r.Rank as number, name: ((r.FullName as string)?.replace(/\s*\([^)]+\)$/, "").trim()) ?? (r.DisplayName as string), uciId: r.UciId as number, points: r.Points as number });
    }
    if (rows.length < PAGE) break;
    skip += PAGE;
    await new Promise(res => setTimeout(res, 300));
  }

  return all.slice(0, LIMIT);
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertPoints(riderId: string, ageCategory: string, gender: string, rank: number, points: number) {
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(riderDisciplineStats.riderId, riderId),
      eq(riderDisciplineStats.discipline, "mtb"),
      eq(riderDisciplineStats.ageCategory, ageCategory),
    ),
  });

  if (existing) {
    await db.update(riderDisciplineStats)
      .set({ uciPoints: points, uciRank: rank, updatedAt: new Date() })
      .where(eq(riderDisciplineStats.id, existing.id));
  } else {
    await db.insert(riderDisciplineStats).values({
      riderId, discipline: "mtb", ageCategory, gender,
      uciPoints: points, uciRank: rank,
      eloMean: "1500", eloVariance: "350",
    }).onConflictDoNothing();
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);

    // Load all riders via raw SQL (faster than ORM findMany for 15k rows)
    const allRiders = await sqlClient`
      SELECT id, name, uci_id FROM riders
    ` as Array<{ id: string; name: string; uci_id: string | null }>;

    console.log(`[mtb-rankings] Loaded ${allRiders.length} riders`);

    const cookie = await initSession();
    const seasons = await apiGet(cookie, "/iframe/GetDisciplineSeasons/?disciplineId=7") as Array<{ Year: number; Id: number; Name: string }>;
    const season = seasons.find(s => s.Year === new Date().getFullYear()) ?? seasons[0];
    const seasonId = season.Id;

    const groups = await apiPost(cookie, "/iframe/RankingsDiscipline/", {
      disciplineId: 7, take: 100, skip: 0, page: 1, pageSize: 100,
      "filter[logic]": "and",
      "filter[filters][0][field]": "RaceTypeId",  "filter[filters][0][operator]": "eq", "filter[filters][0][value]": "0",
      "filter[filters][1][field]": "CategoryId",  "filter[filters][1][operator]": "eq", "filter[filters][1][value]": "0",
      "filter[filters][2][field]": "SeasonId",    "filter[filters][2][operator]": "eq", "filter[filters][2][value]": String(seasonId),
    }) as Array<{ GroupName: string; Rankings: Array<{ Id: number; MomentId: number; CategoryId: number; RaceTypeId: number; RankingTypeId: number; ObjectRankings: unknown[] }> }>;

    let totalUpdated = 0, totalCreated = 0, totalNotFound = 0;
    const categoryResults: string[] = [];

    for (const group of groups) {
      const cat = matchCategory(group.GroupName);
      if (!cat) continue;

      const indiv = group.Rankings?.find(r => r.RankingTypeId === 1);
      if (!indiv) continue;

      const riderList = await fetchRanking(cookie, indiv.Id, indiv.MomentId, indiv.CategoryId, indiv.RaceTypeId, seasonId);
      if (!riderList.length) continue;

      let updated = 0, created = 0, notFound = 0;

      for (const rider of riderList) {
        const match = findRider(rider.name, rider.uciId, allRiders);
        if (!match) {
          // Create new rider
          const [newRider] = await db.insert(riders).values({ name: rider.name })
            .onConflictDoNothing().returning({ id: riders.id });
          if (newRider) {
            allRiders.push({ id: newRider.id, name: rider.name, uci_id: null });
            await upsertPoints(newRider.id, cat.ageCategory, cat.gender, rider.rank, rider.points);
            created++;
          } else notFound++;
          continue;
        }
        await upsertPoints(match.id, cat.ageCategory, cat.gender, rider.rank, rider.points);
        updated++;
      }

      const label = `${cat.ageCategory}/${cat.gender}`;
      categoryResults.push(`${label}: ${updated}↑ ${created}+ ${notFound}?`);
      totalUpdated += updated; totalCreated += created; totalNotFound += notFound;

      await new Promise(r => setTimeout(r, 500));
    }

    const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
    await postToDiscord(
      `🏔️ UCI MTB Rankings [${time}] — ${totalUpdated} updated, ${totalCreated} new, ${totalNotFound} unmatched\n` +
      categoryResults.map(r => `• ${r}`).join("\n")
    );

    return NextResponse.json({
      success: true,
      totalUpdated, totalCreated, totalNotFound,
      categories: categoryResults,
      season: season.Name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron/sync-mtb-rankings]", error);
    await postToDiscord(`🏔️ UCI MTB Rankings ⚠️ Error: ${String(error).substring(0, 200)}`);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
