/**
 * Sync UCI MTB Rankings from dataride.uci.ch (official UCI source)
 *
 * Flow:
 * 1. GET /iframe/rankings/7 → get asp_uci_tr_sessionId cookie
 * 2. GET /iframe/GetDisciplineSeasons/?disciplineId=7 → get current seasonId
 * 3. POST /iframe/RankingsDiscipline/ with season filter → get all ranking groups + top-3
 * 4. For each XCO/cross-country category (Elite M/F, Junior M/F, U23 M/F),
 *    POST /iframe/ObjectRankings/ with rankingId to get full list (paginated)
 * 5. Match riders and upsert into riderDisciplineStats
 *
 * Usage: node_modules/.bin/tsx scripts/agents/sync-mtb-uci.ts [--limit 500] [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const BASE = "https://dataride.uci.ch";
const IFRAME_URL = `${BASE}/iframe/rankings/7`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1] || "500") || 500;
const DRY_RUN = args.includes("--dry-run");

// ── Categories we care about ──────────────────────────────────────────────────
// From the UCI data, GroupName patterns:
// "Cross-country Ranking Men Elite" → elite / men
// "Cross-country Ranking Women Elite" → elite / women
// "Cross-country Men Junior Ranking" → junior / men
// "Cross-country Women Junior Ranking" → junior / women
// "Cross-country Men Under 23 Ranking" → u23 / men (if exists)
// "Cross-country Women Under 23 Ranking" → u23 / women (if exists)
const CATEGORY_MAP: Array<{ groupNameParts: string[]; ageCategory: string; gender: string }> = [
  { groupNameParts: ["cross-country", "men", "elite"],   ageCategory: "elite",  gender: "men"   },
  { groupNameParts: ["cross-country", "women", "elite"], ageCategory: "elite",  gender: "women" },
  { groupNameParts: ["cross-country", "men", "junior"],  ageCategory: "junior", gender: "men"   },
  { groupNameParts: ["cross-country", "women", "junior"],ageCategory: "junior", gender: "women" },
  { groupNameParts: ["cross-country", "men", "under 23"],ageCategory: "u23",    gender: "men"   },
  { groupNameParts: ["cross-country", "women", "under 23"],ageCategory: "u23",  gender: "women" },
  { groupNameParts: ["cross-country", "men", "u23"],     ageCategory: "u23",    gender: "men"   },
  { groupNameParts: ["cross-country", "women", "u23"],   ageCategory: "u23",    gender: "women" },
];

function matchCategory(groupName: string): { ageCategory: string; gender: string } | null {
  const lower = groupName.toLowerCase();
  for (const cat of CATEGORY_MAP) {
    if (cat.groupNameParts.every(part => {
      // Use word-boundary check: "men" should not match inside "women"
      const re = new RegExp(`\\b${part.replace(/\s+/g, "\\s+")}\\b`);
      return re.test(lower);
    })) return cat;
  }
  return null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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
  throw new Error("No asp_uci_tr_sessionId cookie from dataride.uci.ch");
}

async function apiGet(cookie: string, path: string): Promise<any> {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA, "Cookie": cookie, "Accept": "application/json", "Referer": IFRAME_URL },
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function apiPost(cookie: string, path: string, body: Record<string, string | number>): Promise<any> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": IFRAME_URL, "Origin": BASE,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k,v]) => [k, String(v)]))).toString(),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

// ── Fetch full ranking list (paginated) ───────────────────────────────────────

interface UCIRider {
  rank: number;
  name: string;
  uciId: number;
  points: number;
  team: string;
  nation: string;
}

async function fetchFullRanking(
  cookie: string,
  rankingId: number,
  momentId: number,
  categoryId: number,
  raceTypeId: number,
  seasonId: number,
  disciplineId = 7
): Promise<UCIRider[]> {
  const PAGE_SIZE = 200;
  const all: UCIRider[] = [];
  let skip = 0;

  while (all.length < LIMIT) {
    const data = await apiPost(cookie, "/iframe/ObjectRankings/", {
      rankingId,
      disciplineId,
      rankingTypeId: 1,
      take: PAGE_SIZE,
      skip,
      page: Math.floor(skip / PAGE_SIZE) + 1,
      pageSize: PAGE_SIZE,
      "filter[logic]": "and",
      "filter[filters][0][field]": "RaceTypeId",
      "filter[filters][0][operator]": "eq",
      "filter[filters][0][value]": String(raceTypeId),
      "filter[filters][1][field]": "CategoryId",
      "filter[filters][1][operator]": "eq",
      "filter[filters][1][value]": String(categoryId),
      "filter[filters][2][field]": "SeasonId",
      "filter[filters][2][operator]": "eq",
      "filter[filters][2][value]": String(seasonId),
      "filter[filters][3][field]": "MomentId",
      "filter[filters][3][operator]": "eq",
      "filter[filters][3][value]": String(momentId),
    });

    const rows: any[] = data?.data ?? [];
    if (!rows.length) break;

    for (const r of rows) {
      all.push({
        rank: r.Rank,
        name: r.FullName?.replace(/\s*\([^)]+\)$/, "").trim() ?? r.DisplayName,
        uciId: r.UciId,
        points: r.Points,
        team: r.TeamName ?? "",
        nation: r.NationFullName ?? "",
      });
    }

    if (rows.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await new Promise(r => setTimeout(r, 300));
  }

  return all.slice(0, LIMIT);
}

// ── Name matching ─────────────────────────────────────────────────────────────

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findRider(
  name: string,
  uciId: number | null,
  allRiders: { id: string; name: string; uciId?: number | null }[]
): { id: string; name: string } | undefined {
  // Match by UCI ID first (most reliable)
  if (uciId) {
    const byId = allRiders.find(r => (r as any).uciId === uciId);
    if (byId) return byId;
  }

  const norm = stripAccents(name);
  const parts = norm.split(/\s+/);
  const reversed = [...parts].reverse().join(" "); // try "Samara Maxwell" → "Maxwell Samara"
  const tokenSet = new Set(parts);

  // 1. Exact match
  const exact = allRiders.find(r => stripAccents(r.name) === norm);
  if (exact) return exact;

  // 2. Reversed name order (UCI gives "First Last", DB may store "Last First")
  const byReversed = allRiders.find(r => stripAccents(r.name) === reversed);
  if (byReversed) return byReversed;

  // 3. Token-set match: all tokens match regardless of order (handles multi-word names)
  const byTokenSet = allRiders.filter(r => {
    const rParts = stripAccents(r.name).split(/\s+/);
    if (rParts.length !== parts.length) return false;
    return rParts.every(t => tokenSet.has(t));
  });
  if (byTokenSet.length === 1) return byTokenSet[0];

  // 4. Last-name only (conservative — only if unique match)
  const last = parts[parts.length - 1];
  const first = parts[0];
  const byLast = allRiders.filter(r => {
    const n = stripAccents(r.name);
    return n === last || n.endsWith(" " + last);
  });
  if (byLast.length === 1) return byLast[0];

  // 5. First + last tokens present (any order)
  const byBoth = allRiders.filter(r => {
    const n = stripAccents(r.name);
    const rParts = n.split(/\s+/);
    return rParts.includes(first) && rParts.includes(last);
  });
  if (byBoth.length === 1) return byBoth[0];

  return undefined;
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertPoints(riderId: string, ageCategory: string, gender: string, rank: number, points: number) {
  if (DRY_RUN) return;
  const existing = await db.query.riderDisciplineStats.findFirst({
    where: and(
      eq(schema.riderDisciplineStats.riderId, riderId),
      eq(schema.riderDisciplineStats.discipline, "mtb"),
      eq(schema.riderDisciplineStats.ageCategory, ageCategory),
      eq(schema.riderDisciplineStats.gender, gender)
    ),
  });

  if (existing) {
    await db.update(schema.riderDisciplineStats)
      .set({ uciPoints: points, uciRank: rank, updatedAt: new Date() })
      .where(eq(schema.riderDisciplineStats.id, existing.id));
  } else {
    await db.insert(schema.riderDisciplineStats).values({
      riderId, discipline: "mtb", ageCategory, gender,
      uciPoints: points, uciRank: rank,
      currentElo: "1500", eloMean: "1500", eloVariance: "350",
    }).onConflictDoNothing();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🏔️  UCI MTB Rankings Sync (source: dataride.uci.ch)\n`);
  if (DRY_RUN) console.log("⚠️  DRY RUN — no DB writes\n");

  // Load all riders from DB
  const allRiders = await db.query.riders.findMany({ columns: { id: true, name: true } });
  console.log(`Loaded ${allRiders.length} riders from DB\n`);

  // Init session
  console.log("Getting session cookie...");
  const cookie = await initSession();
  console.log("Session OK\n");

  // Get current season
  const seasons = await apiGet(cookie, "/iframe/GetDisciplineSeasons/?disciplineId=7");
  const season2026 = seasons.find((s: any) => s.Year === 2026 || s.Name === "2026");
  const seasonId: number = season2026?.Id ?? seasons[0]?.Id;
  console.log(`Season: ${season2026?.Name ?? "latest"} (id=${seasonId})\n`);

  // Fetch all rankings for this discipline+season
  console.log("Fetching ranking groups...");
  const groups = await apiPost(cookie, "/iframe/RankingsDiscipline/", {
    disciplineId: 7,
    take: 100, skip: 0, page: 1, pageSize: 100,
    "filter[logic]": "and",
    "filter[filters][0][field]": "RaceTypeId",
    "filter[filters][0][operator]": "eq",
    "filter[filters][0][value]": "0",
    "filter[filters][1][field]": "CategoryId",
    "filter[filters][1][operator]": "eq",
    "filter[filters][1][value]": "0",
    "filter[filters][2][field]": "SeasonId",
    "filter[filters][2][operator]": "eq",
    "filter[filters][2][value]": String(seasonId),
  });

  if (!Array.isArray(groups)) throw new Error("RankingsDiscipline returned non-array");
  console.log(`Found ${groups.length} ranking groups\n`);

  let totalUpdated = 0, totalCreated = 0, totalNotFound = 0;

  for (const group of groups) {
    const cat = matchCategory(group.GroupName);
    if (!cat) {
      console.log(`↩️  Skipping "${group.GroupName}" (not XCO/cross-country)`);
      continue;
    }

    // Find the Individual Ranking (rankingTypeId=1) within this group
    const indivRanking = (group.Rankings as any[])?.find((r: any) => r.RankingTypeId === 1);
    if (!indivRanking) {
      console.log(`⚠️  No individual ranking in "${group.GroupName}"`);
      continue;
    }

    console.log(`\n── ${group.GroupName} (id=${indivRanking.Id}) ──`);
    console.log(`   → ageCategory=${cat.ageCategory} gender=${cat.gender}`);

    // Top-3 preview from the groups response
    const top3 = (indivRanking.ObjectRankings as any[]) ?? [];
    if (top3.length > 0) {
      console.log(`   Top 3: ${top3.map((r: any) => `${r.Rank}. ${r.DisplayName} (${r.Points})`).join(", ")}`);
    }

    // Fetch full list
    const riders = await fetchFullRanking(
      cookie, indivRanking.Id, indivRanking.MomentId,
      indivRanking.CategoryId, indivRanking.RaceTypeId,
      seasonId
    );
    console.log(`   Full list: ${riders.length} riders`);
    if (riders.length === 0) continue;

    // Sync to DB
    let updated = 0, created = 0, notFound = 0;
    for (const rider of riders) {
      const match = findRider(rider.name, rider.uciId, allRiders);
      if (!match) {
        if (!DRY_RUN) {
          const [newRider] = await db.insert(schema.riders).values({ name: rider.name })
            .onConflictDoNothing().returning({ id: schema.riders.id });
          if (newRider) {
            allRiders.push({ id: newRider.id, name: rider.name });
            await upsertPoints(newRider.id, cat.ageCategory, cat.gender, rider.rank, rider.points);
            created++;
          } else { notFound++; }
        } else {
          console.log(`   ❓ Not found: ${rider.name}`);
          notFound++;
        }
        continue;
      }
      await upsertPoints(match.id, cat.ageCategory, cat.gender, rider.rank, rider.points);
      updated++;
    }

    console.log(`   ✅ ${updated} updated, ${created} new, ${notFound} unmatched`);
    totalUpdated += updated;
    totalCreated += created;
    totalNotFound += notFound;

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done — ${totalUpdated} updated, ${totalCreated} new, ${totalNotFound} unmatched`);
}

main().catch(console.error);
