import { config } from "dotenv";
config({ path: ".env.local" });

import { chromium } from "playwright";
import { db, races, predictions, riders, raceStartlist, riderDisciplineStats, raceResults, riderRumours, teams } from "./lib/db";
import { eq, desc, and, asc } from "drizzle-orm";

const countryFlags: Record<string, string> = {
  BEL: "🇧🇪", NED: "🇳🇱", FRA: "🇫🇷", ITA: "🇮🇹", ESP: "🇪🇸",
  GBR: "🇬🇧", GER: "🇩🇪", DEU: "🇩🇪", SUI: "🇨🇭", CHE: "🇨🇭",
  AUT: "🇦🇹", DEN: "🇩🇰", NOR: "🇳🇴", SWE: "🇸🇪", USA: "🇺🇸",
  AUS: "🇦🇺", CAN: "🇨🇦", SLO: "🇸🇮", POL: "🇵🇱", CZE: "🇨🇿",
  POR: "🇵🇹", COL: "🇨🇴", ERI: "🇪🇷", RSA: "🇿🇦", LUX: "🇱🇺",
  FIN: "🇫🇮", IRL: "🇮🇪", NZL: "🇳🇿", JPN: "🇯🇵", ECU: "🇪🇨",
  CRO: "🇭🇷", UKR: "🇺🇦", KAZ: "🇰🇿", ETH: "🇪🇹", RWA: "🇷🇼",
  AND: "🇦🇩", BRA: "🇧🇷", ARG: "🇦🇷", MEX: "🇲🇽", CHI: "🇨🇱",
};

function getFlag(code: string | null | undefined): string {
  if (!code) return "🏳️";
  return countryFlags[code.toUpperCase()] ?? "🏳️";
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) i++;
    }
  }
  return args;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatGap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return m > 0 ? `${m}:${s}` : `0:${s}`;
}

interface TopRider {
  name: string;
  nationality: string | null;
  teamName: string | null;
}

async function getTop3Predictions(raceId: string): Promise<TopRider[]> {
  const rows = await db
    .select({
      name: riders.name,
      nationality: riders.nationality,
      predictedPosition: predictions.predictedPosition,
    })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(3);

  if (rows.length > 0) {
    // Get team info from startlist
    const riderTeams = await db
      .select({
        riderName: riders.name,
        teamName: teams.name,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
      .where(eq(raceStartlist.raceId, raceId));

    const teamByName = new Map(riderTeams.map((r) => [r.riderName, r.teamName]));

    return rows.map((r) => ({
      name: r.name,
      nationality: r.nationality,
      teamName: teamByName.get(r.name) || null,
    }));
  }

  // Fallback: top 3 by ELO from startlist
  const race = await db.select().from(races).where(eq(races.id, raceId)).limit(1);
  const discipline = race[0]?.discipline || "road";

  const fallbackRows = await db
    .select({
      name: riders.name,
      nationality: riders.nationality,
      teamName: teams.name,
      elo: riderDisciplineStats.currentElo,
    })
    .from(raceStartlist)
    .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
    .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
    .leftJoin(
      riderDisciplineStats,
      and(
        eq(riderDisciplineStats.riderId, riders.id),
        eq(riderDisciplineStats.discipline, discipline)
      )
    )
    .where(eq(raceStartlist.raceId, raceId))
    .orderBy(desc(riderDisciplineStats.currentElo))
    .limit(3);

  return fallbackRows.map((r) => ({
    name: r.name,
    nationality: r.nationality,
    teamName: r.teamName,
  }));
}

async function getTop3Results(raceId: string): Promise<(TopRider & { timeSeconds: number | null; timeGapSeconds: number | null; position: number | null })[]> {
  const rows = await db
    .select({
      name: riders.name,
      nationality: riders.nationality,
      teamName: teams.name,
      position: raceResults.position,
      timeSeconds: raceResults.timeSeconds,
      timeGapSeconds: raceResults.timeGapSeconds,
    })
    .from(raceResults)
    .innerJoin(riders, eq(raceResults.riderId, riders.id))
    .leftJoin(teams, eq(raceResults.teamId, teams.id))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(asc(raceResults.position))
    .limit(3);

  return rows.map((r) => ({
    name: r.name,
    nationality: r.nationality,
    teamName: r.teamName,
    timeSeconds: r.timeSeconds,
    timeGapSeconds: r.timeGapSeconds,
    position: r.position,
  }));
}

async function getIntelSnippet(raceId: string, riderName: string): Promise<string | null> {
  // Try to find a rumour for the predicted winner in this race
  const rows = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(and(eq(riders.name, riderName), eq(riderRumours.raceId, raceId)))
    .limit(1);

  if (rows.length > 0 && rows[0].summary) return rows[0].summary;

  // Fallback: any rumour for this rider
  const fallback = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(eq(riders.name, riderName))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(1);

  return fallback.length > 0 ? fallback[0].summary : null;
}

async function getStartlistCount(raceId: string): Promise<number> {
  const rows = await db
    .select({ id: raceStartlist.id })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, raceId));
  return rows.length;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPreviewHtml(
  raceName: string,
  dateDisplay: string,
  countryFlag: string,
  country: string,
  uciCategory: string,
  riderCount: number,
  top3: TopRider[],
  intel: string | null
): string {
  const predictionsHtml = top3
    .map((r, i) => {
      const posClass = i === 0 ? "pos-1" : i === 1 ? "pos-2" : "pos-3";
      return `
    <div class="prediction-row">
      <div class="pos ${posClass}">${i + 1}</div>
      <div style="flex:1">
        <div class="rider-name">${escapeHtml(r.name)} <span class="rider-flag">${getFlag(r.nationality)}</span></div>
        ${r.teamName ? `<div class="rider-team">${escapeHtml(r.teamName)}</div>` : ""}
      </div>
    </div>`;
    })
    .join("\n");

  const intelHtml = intel
    ? `<div class="intel-box"><div class="section-title" style="margin-bottom:12px">🕵️ Intel</div><div class="intel-text">${escapeHtml(intel)}</div></div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1080px; height: 1080px;
    background: linear-gradient(135deg, #0a0e1a 0%, #111827 50%, #0f172a 100%);
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
    color: white;
    overflow: hidden;
    position: relative;
  }
  .accent-bar { height: 6px; background: linear-gradient(90deg, #dc2626, #ef4444, #f97316); }
  .container { padding: 56px 64px; height: calc(1080px - 6px); display: flex; flex-direction: column; }
  .eyebrow { font-size: 14px; font-weight: 700; letter-spacing: 4px; color: #ef4444; text-transform: uppercase; margin-bottom: 16px; }
  .race-name { font-size: 64px; font-weight: 900; line-height: 1.05; color: white; margin-bottom: 8px; letter-spacing: -1px; }
  .race-meta { display: flex; gap: 20px; margin-top: 20px; margin-bottom: 48px; flex-wrap: wrap; }
  .meta-pill { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; padding: 8px 18px; font-size: 15px; font-weight: 600; color: #d1d5db; }
  .meta-pill.red { background: rgba(220,38,38,0.15); border-color: rgba(220,38,38,0.3); color: #fca5a5; }
  .divider { height: 1px; background: rgba(255,255,255,0.08); margin-bottom: 40px; }
  .section-title { font-size: 12px; font-weight: 700; letter-spacing: 3px; color: #6b7280; text-transform: uppercase; margin-bottom: 24px; }
  .predictions { display: flex; flex-direction: column; gap: 16px; margin-bottom: 44px; }
  .prediction-row { display: flex; align-items: center; gap: 20px; }
  .pos { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; flex-shrink: 0; }
  .pos-1 { background: linear-gradient(135deg, #f59e0b, #d97706); color: #1c1917; }
  .pos-2 { background: rgba(148,163,184,0.2); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.3); }
  .pos-3 { background: rgba(180,120,60,0.2); color: #d4a76a; border: 1px solid rgba(180,120,60,0.3); }
  .rider-name { font-size: 26px; font-weight: 800; color: white; flex: 1; }
  .rider-flag { font-size: 24px; }
  .rider-team { font-size: 13px; color: #6b7280; font-weight: 500; margin-top: 2px; }
  .intel-box { background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.15); border-left: 3px solid #ef4444; border-radius: 12px; padding: 20px 24px; margin-bottom: 44px; }
  .intel-text { font-size: 16px; color: #d1d5db; line-height: 1.6; }
  .footer { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; }
  .site-url { font-size: 16px; color: #4b5563; font-weight: 600; }
  .brand { font-size: 22px; font-weight: 900; color: white; letter-spacing: -0.5px; }
  .brand span { color: #ef4444; }
</style>
</head>
<body>
<div class="accent-bar"></div>
<div class="container">
  <div class="eyebrow">🏁 Race Preview</div>
  <div class="race-name">${escapeHtml(raceName)}</div>
  <div class="race-meta">
    <div class="meta-pill">${escapeHtml(dateDisplay)}</div>
    <div class="meta-pill">${countryFlag} ${escapeHtml(country)}</div>
    <div class="meta-pill red">${escapeHtml(uciCategory)}</div>
    <div class="meta-pill">${riderCount} Riders</div>
  </div>
  <div class="divider"></div>
  <div class="section-title">🔮 Our Predictions</div>
  <div class="predictions">
    ${predictionsHtml}
  </div>
  ${intelHtml}
  <div class="footer">
    <div class="site-url">procyclingpredictor.com</div>
    <div class="brand">Pro<span>Cycling</span> Predictor</div>
  </div>
</div>
</body>
</html>`;
}

function buildResultHtml(
  raceName: string,
  dateDisplay: string,
  countryFlag: string,
  country: string,
  uciCategory: string,
  top3: (TopRider & { timeSeconds: number | null; timeGapSeconds: number | null; position: number | null })[]
): string {
  const podiumHtml = top3
    .map((r, i) => {
      const posClass = i === 0 ? "pos-1" : i === 1 ? "pos-2" : "pos-3";
      const timeStr =
        i === 0 && r.timeSeconds
          ? formatTime(r.timeSeconds)
          : r.timeGapSeconds
          ? `+${formatGap(r.timeGapSeconds)}`
          : "";
      return `
    <div class="prediction-row">
      <div class="pos ${posClass}">${i + 1}</div>
      <div style="flex:1">
        <div class="rider-name">${escapeHtml(r.name)} <span class="rider-flag">${getFlag(r.nationality)}</span></div>
        ${r.teamName ? `<div class="rider-team">${escapeHtml(r.teamName)}</div>` : ""}
      </div>
      ${timeStr ? `<div style="font-size:18px;color:#9ca3af;font-weight:600;font-variant-numeric:tabular-nums">${timeStr}</div>` : ""}
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1080px; height: 1080px;
    background: linear-gradient(135deg, #0a0e1a 0%, #111827 50%, #0f172a 100%);
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
    color: white;
    overflow: hidden;
    position: relative;
  }
  .accent-bar { height: 6px; background: linear-gradient(90deg, #dc2626, #ef4444, #f97316); }
  .container { padding: 56px 64px; height: calc(1080px - 6px); display: flex; flex-direction: column; }
  .eyebrow { font-size: 14px; font-weight: 700; letter-spacing: 4px; color: #ef4444; text-transform: uppercase; margin-bottom: 16px; }
  .race-name { font-size: 64px; font-weight: 900; line-height: 1.05; color: white; margin-bottom: 8px; letter-spacing: -1px; }
  .race-meta { display: flex; gap: 20px; margin-top: 20px; margin-bottom: 48px; flex-wrap: wrap; }
  .meta-pill { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; padding: 8px 18px; font-size: 15px; font-weight: 600; color: #d1d5db; }
  .meta-pill.red { background: rgba(220,38,38,0.15); border-color: rgba(220,38,38,0.3); color: #fca5a5; }
  .divider { height: 1px; background: rgba(255,255,255,0.08); margin-bottom: 40px; }
  .section-title { font-size: 12px; font-weight: 700; letter-spacing: 3px; color: #6b7280; text-transform: uppercase; margin-bottom: 24px; }
  .predictions { display: flex; flex-direction: column; gap: 16px; margin-bottom: 44px; }
  .prediction-row { display: flex; align-items: center; gap: 20px; }
  .pos { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; flex-shrink: 0; }
  .pos-1 { background: linear-gradient(135deg, #f59e0b, #d97706); color: #1c1917; }
  .pos-2 { background: rgba(148,163,184,0.2); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.3); }
  .pos-3 { background: rgba(180,120,60,0.2); color: #d4a76a; border: 1px solid rgba(180,120,60,0.3); }
  .rider-name { font-size: 26px; font-weight: 800; color: white; flex: 1; }
  .rider-flag { font-size: 24px; }
  .rider-team { font-size: 13px; color: #6b7280; font-weight: 500; margin-top: 2px; }
  .footer { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; }
  .site-url { font-size: 16px; color: #4b5563; font-weight: 600; }
  .brand { font-size: 22px; font-weight: 900; color: white; letter-spacing: -0.5px; }
  .brand span { color: #ef4444; }
</style>
</head>
<body>
<div class="accent-bar"></div>
<div class="container">
  <div class="eyebrow">🏆 Race Result</div>
  <div class="race-name">${escapeHtml(raceName)}</div>
  <div class="race-meta">
    <div class="meta-pill">${escapeHtml(dateDisplay)}</div>
    <div class="meta-pill">${countryFlag} ${escapeHtml(country)}</div>
    <div class="meta-pill red">${escapeHtml(uciCategory)}</div>
  </div>
  <div class="divider"></div>
  <div class="section-title">🎯 Final Podium</div>
  <div class="predictions">
    ${podiumHtml}
  </div>
  <div class="footer">
    <div class="site-url">procyclingpredictor.com</div>
    <div class="brand">Pro<span>Cycling</span> Predictor</div>
  </div>
</div>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceId = args["race-id"];
  const type = args["type"] as "preview" | "result";

  if (!raceId || !type) {
    console.error("Usage: tsx scripts/agents/generate-race-graphic.ts --race-id <uuid> --type <preview|result>");
    process.exit(1);
  }

  // Fetch race
  const [race] = await db.select().from(races).where(eq(races.id, raceId)).limit(1);
  if (!race) {
    console.error(`Race not found: ${raceId}`);
    process.exit(1);
  }

  const dateDisplay = formatDate(race.date);
  const countryFlag = getFlag(race.country);
  const country = race.country || "TBD";
  const uciCategory = race.uciCategory || race.raceType || "Race";

  let html: string;

  if (type === "preview") {
    const top3 = await getTop3Predictions(raceId);
    const riderCount = await getStartlistCount(raceId);
    const intel = top3.length > 0 ? await getIntelSnippet(raceId, top3[0].name) : null;

    if (top3.length === 0) {
      console.error("No predictions or riders found for this race");
      process.exit(1);
    }

    html = buildPreviewHtml(race.name, dateDisplay, countryFlag, country, uciCategory, riderCount, top3, intel);
  } else {
    const top3 = await getTop3Results(raceId);
    if (top3.length === 0) {
      console.error("No results found for this race");
      process.exit(1);
    }

    html = buildResultHtml(race.name, dateDisplay, countryFlag, country, uciCategory, top3);
  }

  // Render with Playwright
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.setContent(html, { waitUntil: "networkidle" });

  const outputPath = `/tmp/race-graphic-${raceId}.png`;
  await page.screenshot({ path: outputPath, type: "png" });
  await browser.close();

  // Output path to stdout for caller to capture
  console.log(outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
