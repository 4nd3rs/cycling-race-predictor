import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = "https://dataride.uci.ch";
const IFRAME_URL = `${BASE}/iframe/rankings/7`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function initSession(): Promise<string> {
  const res = await fetch(IFRAME_URL, {
    headers: { "User-Agent": UA, "Accept": "text/html" },
    signal: AbortSignal.timeout(15000),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [nv] = c.split(";"); const [n, v] = nv.split("=");
    if (n?.trim() === "asp_uci_tr_sessionId") return `asp_uci_tr_sessionId=${v.trim()}`;
  }
  return "";
}

async function post(cookie: string, path: string, body: Record<string, string | number>): Promise<any> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": IFRAME_URL, "Origin": BASE, "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k,v]) => [k, String(v)]))).toString(),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  console.log(`POST ${path}: ${res.status} (${text.length} chars) ${text.substring(0, 200)}`);
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const cookie = await initSession();
  console.log("Session:", cookie.substring(0, 50), "\n");

  // Try ObjectRankings with full Kendo filters
  // rankingId=148 (Men Elite XCO), momentId=198514, categoryId=22 (Elite), raceTypeId=92 (XCO), seasonId=453 (2026)
  const filterBody: Record<string, string | number> = {
    rankingId: 148,
    disciplineId: 7,
    rankingTypeId: 1,
    take: 40,
    skip: 0,
    page: 1,
    pageSize: 40,
    "filter[logic]": "and",
    "filter[filters][0][field]": "RaceTypeId",
    "filter[filters][0][operator]": "eq",
    "filter[filters][0][value]": "92",
    "filter[filters][1][field]": "CategoryId",
    "filter[filters][1][operator]": "eq",
    "filter[filters][1][value]": "22",
    "filter[filters][2][field]": "SeasonId",
    "filter[filters][2][operator]": "eq",
    "filter[filters][2][value]": "453",
    "filter[filters][3][field]": "MomentId",
    "filter[filters][3][operator]": "eq",
    "filter[filters][3][value]": "198514",
  };

  console.log("=== ObjectRankings with full Kendo filter ===");
  const r1 = await post(cookie, "/iframe/ObjectRankings/", filterBody);
  if (r1?.data?.length > 0) {
    console.log(`✅ Got ${r1.total} riders!`);
    r1.data.slice(0, 5).forEach((r: any) => {
      console.log(`  ${r.Rank}. ${r.FullName || r.DisplayName} (${r.Points} pts)`);
    });
  }

  // Also try via the RankingDetails URL as referer (simulate being on that page)
  console.log("\n=== ObjectRankings with RankingDetails referer ===");
  const rdUrl = `${BASE}/iframe/RankingDetails/148?disciplineId=7&groupId=35&momentId=198514&disciplineSeasonId=453&rankingTypeId=1&categoryId=22&raceTypeId=92`;
  const res2 = await fetch(BASE + "/iframe/ObjectRankings/", {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": rdUrl, "Origin": BASE, "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(Object.fromEntries(Object.entries(filterBody).map(([k,v]) => [k, String(v)]))).toString(),
    signal: AbortSignal.timeout(30000),
  });
  const t2 = await res2.text();
  console.log(`Status: ${res2.status} (${t2.length} chars) ${t2.substring(0, 200)}`);
}
main().catch(console.error);
