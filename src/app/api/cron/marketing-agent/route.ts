import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  db,
  races,
  raceResults,
  raceEvents,
  raceNews,
  predictions,
  riders,
  raceStartlist,
  riderDisciplineStats,
  riderRumours,
  notificationLog,
} from "@/lib/db";
import { eq, and, gte, lte, asc, desc, sql } from "drizzle-orm";

export const maxDuration = 60;

// ── Country flags ─────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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

function makeHashtag(raceName: string): string {
  return raceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

// ── Tracking via notificationLog ──────────────────────────────────────────────

async function hasBeenPosted(raceId: string, type: "marketing-preview" | "marketing-result"): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(
      eq(notificationLog.userId, "system"),
      eq(notificationLog.channel, "marketing"),
      eq(notificationLog.eventType, type),
      eq(notificationLog.entityId, raceId),
    ))
    .limit(1);
  return !!row;
}

async function markPosted(raceId: string, type: "marketing-preview" | "marketing-result"): Promise<void> {
  await db.insert(notificationLog).values({
    userId: "system",
    channel: "marketing",
    eventType: type,
    entityId: raceId,
  }).catch(() => {});
}

// ── DB queries ────────────────────────────────────────────────────────────────

async function getTop3Predictions(raceId: string, discipline: string) {
  const rows = await db
    .select({ name: riders.name, nationality: riders.nationality })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(3);

  if (rows.length > 0) return rows;

  // Fallback: top ELO from startlist
  return db
    .select({ name: riders.name, nationality: riders.nationality })
    .from(raceStartlist)
    .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
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
}

async function getTop3Results(raceId: string) {
  return db
    .select({
      name: riders.name,
      nationality: riders.nationality,
      position: raceResults.position,
      timeSeconds: raceResults.timeSeconds,
      timeGapSeconds: raceResults.timeGapSeconds,
    })
    .from(raceResults)
    .innerJoin(riders, eq(raceResults.riderId, riders.id))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(asc(raceResults.position))
    .limit(3);
}

async function getStartlistCount(raceId: string): Promise<number> {
  const rows = await db
    .select({ id: raceStartlist.id })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, raceId));
  return rows.length;
}

async function getIntelFromDb(raceEventId: string): Promise<string[]> {
  const newsRows = await db
    .select({ title: raceNews.title, summary: raceNews.summary })
    .from(raceNews)
    .where(eq(raceNews.raceEventId, raceEventId))
    .orderBy(desc(raceNews.publishedAt))
    .limit(5);

  return newsRows
    .map((n) => n.summary || n.title)
    .filter(Boolean)
    .slice(0, 3);
}

async function getIntelSnippet(raceId: string, riderName: string): Promise<string | null> {
  const rows = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(and(eq(riders.name, riderName), eq(riderRumours.raceId, raceId)))
    .limit(1);

  if (rows.length > 0 && rows[0].summary) return rows[0].summary;

  const fallback = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(eq(riders.name, riderName))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(1);

  return fallback.length > 0 ? fallback[0].summary : null;
}

// ── Build captions ────────────────────────────────────────────────────────────

async function buildPreviewMessage(
  race: typeof races.$inferSelect,
  raceId: string,
  raceEventId: string | null
): Promise<string> {
  const top3 = await getTop3Predictions(raceId, race.discipline);
  const riderCount = await getStartlistCount(raceId);
  const intel = top3.length > 0 ? await getIntelSnippet(raceId, top3[0].name) : null;

  const weekday = formatWeekday(race.date);
  const dateStr = formatDateDisplay(race.date);
  const country = race.country || "TBD";
  const uciCategory = race.uciCategory || race.raceType || "Race";
  const hashtag = makeHashtag(race.name);

  const p1 = top3[0] ? `🥇 ${top3[0].name} ${getFlag(top3[0].nationality)}` : "";
  const p2 = top3[1] ? `🥈 ${top3[1].name} ${getFlag(top3[1].nationality)}` : "";
  const p3 = top3[2] ? `🥉 ${top3[2].name} ${getFlag(top3[2].nationality)}` : "";

  // Get intel from race_news table
  const intelLines: string[] = [];
  if (intel) intelLines.push(intel);
  if (raceEventId) {
    const dbIntel = await getIntelFromDb(raceEventId);
    for (const line of dbIntel.slice(0, 2)) {
      const truncated = line.length > 100 ? line.slice(0, 97) + "..." : line;
      if (!intelLines.includes(truncated)) intelLines.push(truncated);
    }
  }

  const intelSection = intelLines.length > 0
    ? `\n━━━━━━━━━━━━━━━\n🕵️ INTEL\n━━━━━━━━━━━━━━━\n${intelLines.join("\n")}`
    : "";

  return `🏁 <b>RACE PREVIEW</b>

<b>${race.name}</b>
📅 ${weekday}, ${dateStr}
${getFlag(race.country)} ${country} · ${uciCategory} · ${riderCount} riders

━━━━━━━━━━━━━━━
🏆 PREDICTIONS
━━━━━━━━━━━━━━━
${p1}
${p2}
${p3}
${intelSection}

🔮 Full predictions & startlist:
procyclingpredictor.com

#cycling #roadcycling #procycling #${hashtag}`;
}

async function buildResultMessage(
  race: typeof races.$inferSelect,
  raceId: string
): Promise<string> {
  const top3 = await getTop3Results(raceId);
  const dateStr = formatDateDisplay(race.date);
  const country = race.country || "TBD";

  const p1Line = top3[0]
    ? `🥇 ${top3[0].name} ${getFlag(top3[0].nationality)}${top3[0].timeSeconds ? ` — ${formatTime(top3[0].timeSeconds)}` : ""}`
    : "";
  const p2Line = top3[1]
    ? `🥈 ${top3[1].name} ${getFlag(top3[1].nationality)}${top3[1].timeGapSeconds ? ` +${formatGap(top3[1].timeGapSeconds)}` : ""}`
    : "";
  const p3Line = top3[2]
    ? `🥉 ${top3[2].name} ${getFlag(top3[2].nationality)}${top3[2].timeGapSeconds ? ` +${formatGap(top3[2].timeGapSeconds)}` : ""}`
    : "";

  // Check if we predicted the winner
  const predictedTop = await db
    .select({ name: riders.name })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(1);

  let callItLine = "";
  if (predictedTop.length > 0 && top3.length > 0) {
    if (predictedTop[0].name === top3[0].name) {
      callItLine = "✅ We called it! Our AI predicted the winner.";
    } else {
      callItLine = `🤔 Surprised! We predicted ${predictedTop[0].name}.`;
    }
  }

  return `🏆 <b>RACE RESULT</b>

<b>${race.name}</b>
📅 ${dateStr} · ${getFlag(race.country)} ${country}

━━━━━━━━━━━━━━━
🎯 FINAL PODIUM
━━━━━━━━━━━━━━━
${p1Line}
${p2Line}
${p3Line}

${callItLine}

📊 Updated rankings & ELO:
procyclingpredictor.com

#cycling #roadcycling #procycling`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ race: string; type: string; status: string }> = [];

  try {
    // ─── 1. PREVIEW: Upcoming races in next 3 days ───────────────
    const today = dayStr(0);
    const threeDaysOut = dayStr(3);

    const upcomingRacesRaw = await db
      .select()
      .from(races)
      .where(
        and(
          gte(races.date, today),
          lte(races.date, threeDaysOut),
          eq(races.status, "active")
        )
      )
      .orderBy(races.date);

    // Enrich with event country/discipline
    const upcomingRaces = await Promise.all(upcomingRacesRaw.map(async (race) => {
      if (!race.raceEventId) return { ...race, country: race.country };
      try {
        const [ev] = await db
          .select({ country: raceEvents.country, discipline: raceEvents.discipline })
          .from(raceEvents)
          .where(eq(raceEvents.id, race.raceEventId))
          .limit(1);
        return {
          ...race,
          country: ev?.country ?? race.country,
          discipline: ev?.discipline ?? race.discipline,
        };
      } catch { return race; }
    }));

    for (const race of upcomingRaces) {
      if (await hasBeenPosted(race.id, "marketing-preview")) {
        results.push({ race: race.name, type: "preview", status: "already_posted" });
        continue;
      }

      try {
        await buildPreviewMessage(race, race.id, race.raceEventId);
        await markPosted(race.id, "marketing-preview");
        results.push({ race: race.name, type: "preview", status: "posted" });
      } catch (err) {
        console.error(`[cron/marketing-agent] Preview failed for ${race.name}:`, err);
        results.push({ race: race.name, type: "preview", status: "error" });
      }
    }

    // ─── 2. RESULTS: Races completed yesterday ────────────────────
    const yesterday = dayStr(-1);

    const completedRacesRaw = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.date, yesterday),
          sql`${races.id} IN (SELECT ${raceResults.raceId} FROM ${raceResults} GROUP BY ${raceResults.raceId})`
        )
      )
      .orderBy(races.date);

    const completedRaces = await Promise.all(completedRacesRaw.map(async (race) => {
      if (!race.raceEventId) return { ...race, country: race.country };
      try {
        const [ev] = await db
          .select({ country: raceEvents.country, discipline: raceEvents.discipline })
          .from(raceEvents)
          .where(eq(raceEvents.id, race.raceEventId))
          .limit(1);
        return {
          ...race,
          country: ev?.country ?? race.country,
          discipline: ev?.discipline ?? race.discipline,
        };
      } catch { return race; }
    }));

    for (const race of completedRaces) {
      if (await hasBeenPosted(race.id, "marketing-result")) {
        results.push({ race: race.name, type: "result", status: "already_posted" });
        continue;
      }

      try {
        await buildResultMessage(race, race.id);
        await markPosted(race.id, "marketing-result");
        results.push({ race: race.name, type: "result", status: "posted" });
      } catch (err) {
        console.error(`[cron/marketing-agent] Result failed for ${race.name}:`, err);
        results.push({ race: race.name, type: "result", status: "error" });
      }
    }

    const posted = results.filter((r) => r.status === "posted").length;
    return NextResponse.json({
      success: true,
      posted,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error("[cron/marketing-agent]", error);
    // Post to Discord for visibility
    const discordToken = process.env.DISCORD_BOT_TOKEN;
    if (discordToken) {
      await fetch("https://discord.com/api/v10/channels/1476643255243509912/messages", {
        method: "POST",
        headers: { "Authorization": `Bot ${discordToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: `📢 Marketing Agent ⚠️ Error: ${String(error).substring(0, 200)}` }),
      }).catch(() => {});
    }
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
