/**
 * POST/GET /api/cron/whatsapp-groups
 * Posts race previews, raceday hype, and results to WhatsApp groups via the Fly.io gateway.
 * Covers both Road and MTB disciplines.
 * Runs every 2 hours — each run checks all windows and posts what's needed.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  raceResults,
  raceEvents,
  riders,
  raceStartlist,
  predictions,
  teams,
  userFollows,
  userWhatsapp,
  notificationLog,
} from "@/lib/db";
import { eq, and, gte, lte, desc, asc, inArray, isNotNull, sql } from "drizzle-orm";

export const maxDuration = 60;

const APP_URL = "https://procyclingpredictor.com";
const ROAD_GROUP = "120363425402092416@g.us";
const MTB_GROUP = "120363405998540593@g.us";

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── WA Gateway ────────────────────────────────────────────────────────────────

async function sendToWA(groupJid: string, text: string): Promise<boolean> {
  const gateway = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!gateway || !token) {
    console.warn("WA gateway not configured");
    return false;
  }

  const res = await fetch(`${gateway}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: groupJid, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`WA send failed: ${res.status} ${body}`);
    return false;
  }
  return true;
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function generate(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return null;

  // Reject unfilled template placeholders
  if (/\[Top Pick \d+ Name\]|\[.*Name.*\]|\[.*placeholder.*\]/i.test(text)) {
    console.error("Gemini returned unfilled placeholders");
    return null;
  }
  return text;
}

// ── Dedup via notificationLog ─────────────────────────────────────────────────

type PostType = "wa-preview" | "wa-raceday" | "wa-result";

async function hasBeenPosted(raceId: string, type: PostType, channel: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(
      eq(notificationLog.userId, "system"),
      eq(notificationLog.channel, channel),
      eq(notificationLog.eventType, type),
      eq(notificationLog.entityId, raceId),
    ))
    .limit(1);
  return !!row;
}

async function markPosted(raceId: string, type: PostType, channel: string): Promise<void> {
  await db.insert(notificationLog).values({
    userId: "system",
    channel,
    eventType: type,
    entityId: raceId,
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function parseDate(raw: string): string {
  return new Date(raw).toISOString().slice(0, 10);
}

// ── Group interest filter (road only) ─────────────────────────────────────────

async function getGroupFollowedEventIds(): Promise<Set<string>> {
  const waUsers = await db.select({ userId: userWhatsapp.userId }).from(userWhatsapp);
  const userIds = waUsers.map(u => u.userId);
  if (userIds.length === 0) return new Set();

  const follows = await db.select({ entityId: userFollows.entityId })
    .from(userFollows)
    .where(and(
      eq(userFollows.followType, "race_event"),
      inArray(userFollows.userId, userIds),
    ));
  return new Set(follows.map(f => f.entityId));
}

async function isRoadRaceOfInterest(raceEventId: string | null, uciCategory?: string | null): Promise<boolean> {
  if (!raceEventId) return false;
  if (uciCategory === "WorldTour") return true;
  const followed = await getGroupFollowedEventIds();
  if (followed.size === 0) return true; // graceful degradation
  return followed.has(raceEventId);
}

// ── Data queries ──────────────────────────────────────────────────────────────

async function getTopPredictions(raceId: string, limit = 5) {
  const preds = await db.select({
    name: riders.name, team: teams.name, winProbability: predictions.winProbability,
  })
    .from(predictions)
    .leftJoin(riders, eq(predictions.riderId, riders.id))
    .leftJoin(raceStartlist, and(eq(raceStartlist.raceId, raceId), eq(raceStartlist.riderId, predictions.riderId)))
    .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
    .where(and(eq(predictions.raceId, raceId), isNotNull(predictions.winProbability)))
    .orderBy(desc(predictions.winProbability))
    .limit(limit * 3);

  const seen = new Set<string>();
  return preds.filter(p => {
    const key = (p.name ?? "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function getRecentResults(raceId: string) {
  return db.select({ position: raceResults.position, riderName: riders.name, teamName: teams.name })
    .from(raceResults)
    .leftJoin(riders, eq(raceResults.riderId, riders.id))
    .leftJoin(teams, eq(raceResults.teamId, teams.id))
    .where(and(
      eq(raceResults.raceId, raceId),
      sql`${raceResults.position} IS NOT NULL`,
      sql`(${raceResults.dnf} IS NULL OR ${raceResults.dnf} = false)`,
    ))
    .orderBy(raceResults.position)
    .limit(10);
}

// ── Dedup by event slug ───────────────────────────────────────────────────────

interface RaceRow {
  id: string;
  name: string;
  date: string;
  discipline: string;
  gender: string | null;
  uciCategory: string | null;
  categorySlug: string | null;
  raceEventId: string | null;
  eventName: string | null;
  eventSlug: string | null;
  country: string | null;
}

function deduplicateByEvent(raceRows: RaceRow[]): RaceRow[] {
  const bySlug = new Map<string, RaceRow>();
  for (const race of raceRows) {
    const key = race.eventSlug ?? race.id;
    const existing = bySlug.get(key);
    if (!existing) { bySlug.set(key, race); continue; }
    // Prefer men's edition (usually has more/better predictions)
    if (race.gender === "men" && existing.gender !== "men") bySlug.set(key, race);
    if (race.categorySlug === "elite-men" && existing.categorySlug !== "elite-men") bySlug.set(key, race);
  }
  return Array.from(bySlug.values());
}

// ── Race queries ──────────────────────────────────────────────────────────────

async function getRaces(discipline: string, dayMin: number, dayMax: number): Promise<RaceRow[]> {
  const rows = await db.select({
    id: races.id, name: races.name, date: races.date, discipline: races.discipline,
    gender: races.gender, uciCategory: races.uciCategory, categorySlug: races.categorySlug,
    raceEventId: races.raceEventId,
    eventName: raceEvents.name, eventSlug: raceEvents.slug, country: raceEvents.country,
  })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, discipline),
      eq(races.status, "active"),
      gte(races.date, dayStr(dayMin)),
      lte(races.date, dayStr(dayMax)),
    ))
    .orderBy(races.date);

  return rows.map(r => ({ ...r, date: r.date as string }));
}

async function getCompletedRaces(discipline: string): Promise<RaceRow[]> {
  const rows = await db.select({
    id: races.id, name: races.name, date: races.date, discipline: races.discipline,
    gender: races.gender, uciCategory: races.uciCategory, categorySlug: races.categorySlug,
    raceEventId: races.raceEventId,
    eventName: raceEvents.name, eventSlug: raceEvents.slug, country: raceEvents.country,
  })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, discipline),
      gte(races.date, dayStr(-2)),
      lte(races.date, dayStr(0)),
      sql`${races.id} IN (SELECT race_id FROM race_results GROUP BY race_id HAVING count(*) >= 3)`,
    ))
    .orderBy(desc(races.date));

  return rows.map(r => ({ ...r, date: r.date as string }));
}

// ── Post builders ─────────────────────────────────────────────────────────────

function raceUrl(discipline: string, eventSlug: string | null): string {
  if (!eventSlug) return APP_URL;
  return `${APP_URL}/races/${discipline}/${eventSlug}`;
}

async function buildPreviewPrompt(race: RaceRow, discipline: string): Promise<string | null> {
  const preds = await getTopPredictions(race.id, 5);
  if (preds.length === 0) return null;

  const predText = preds.map((p, i) => `${i + 1}. ${p.name} (${p.team ?? "?"})`).join("\n");
  const url = raceUrl(discipline, race.eventSlug);
  const isMtb = discipline === "mtb";
  const emoji = isMtb ? "🚵" : "🏁";

  return `You write punchy WhatsApp race preview messages for Pro Cycling Predictor.
Write a sharp ${isMtb ? "MTB" : "road"} race preview for ${race.eventName ?? race.name} (${parseDate(race.date)}).

Our top predictions:
${predText}

Format:
${emoji} *${race.eventName ?? race.name}* — ${parseDate(race.date)}
[2-3 sentences about the race, what to look for, who to watch]

🔮 *Our top picks:*
1. Name
2. Name
3. Name

👉 Full preview: ${url}

Rules:
- Max 150 words total
- *bold* for rider and race names
- Sound like a knowledgeable cycling fan, not a press release
- 1-2 emojis max
- No hashtags`;
}

async function buildRacedayPrompt(race: RaceRow, discipline: string): Promise<string | null> {
  const preds = await getTopPredictions(race.id, 3);
  if (preds.length === 0) return null;

  const url = raceUrl(discipline, race.eventSlug);
  const topPick = preds[0]?.name ?? "unknown";
  const isMtb = discipline === "mtb";
  const emoji = isMtb ? "🚵" : "🚴";

  return `Short race-day WhatsApp hype message for ${isMtb ? "MTB race" : ""} ${race.eventName ?? race.name}.
Our top pick: ${topPick}${preds[1] ? ` (chased by ${preds[1].name})` : ""}.

Max 80 words. Start with a ${emoji} emoji and the race name in bold. End with a link.
Sound excited. One key tactical insight.
Link: ${url}
No hashtags.`;
}

async function buildResultPrompt(race: RaceRow, discipline: string): Promise<string | null> {
  const results = await getRecentResults(race.id);
  if (results.length < 3) return null;

  const podium = results.slice(0, 3).map((r, i) => `${i + 1}. *${r.riderName}* (${r.teamName ?? "?"})`).join("\n");
  const url = raceUrl(discipline, race.eventSlug);

  return `Short WhatsApp results post for ${race.eventName ?? race.name}.

Podium:
${podium}

Max 100 words. Lead with winner's name in bold + 🏆. Add one punchy insight about the race.
End with updated rankings link: ${url}
No hashtags.`;
}

// ── MTB priority filter ───────────────────────────────────────────────────────

const MTB_HIGH_PRIORITY = new Set(["WorldCup", "World Cup", "WHOOP UCI MTB World Series", "CC"]);
const MTB_MED_PRIORITY = new Set(["C1", "HC"]);
const ELITE_CATS = new Set(["elite-men", "elite-women"]);

function isMtbEligible(race: RaceRow): boolean {
  if (!ELITE_CATS.has(race.categorySlug ?? "")) return false;
  const cat = race.uciCategory ?? "";
  return MTB_HIGH_PRIORITY.has(cat) || MTB_MED_PRIORITY.has(cat);
}

// ── Main logic ────────────────────────────────────────────────────────────────

interface PostResult {
  race: string;
  discipline: string;
  type: string;
  status: string;
}

async function processAllGroups(): Promise<PostResult[]> {
  const results: PostResult[] = [];

  // Process both disciplines
  for (const discipline of ["road", "mtb"] as const) {
    const groupJid = discipline === "road" ? ROAD_GROUP : MTB_GROUP;
    const channel = `whatsapp-${discipline}`;

    // ── PREVIEWS: 1-2 days ahead ──────────────────────────────────
    const previewRaces = deduplicateByEvent(await getRaces(discipline, 1, 2));
    for (const race of previewRaces.slice(0, 3)) {
      if (await hasBeenPosted(race.id, "wa-preview", channel)) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "already_posted" });
        continue;
      }

      // Interest/priority filter
      if (discipline === "road") {
        if (!(await isRoadRaceOfInterest(race.raceEventId, race.uciCategory))) {
          results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "not_followed" });
          continue;
        }
      } else if (!isMtbEligible(race)) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "low_priority" });
        continue;
      }

      const prompt = await buildPreviewPrompt(race, discipline);
      if (!prompt) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "no_predictions" });
        continue;
      }

      const text = await generate(prompt);
      if (!text) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "gen_failed" });
        continue;
      }

      const sent = await sendToWA(groupJid, text);
      if (sent) await markPosted(race.id, "wa-preview", channel);
      results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: sent ? "posted" : "send_failed" });
    }

    // ── RACEDAY: today ────────────────────────────────────────────
    const todayRaces = deduplicateByEvent(await getRaces(discipline, 0, 0));
    for (const race of todayRaces.slice(0, 2)) {
      if (await hasBeenPosted(race.id, "wa-raceday", channel)) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "raceday", status: "already_posted" });
        continue;
      }

      if (discipline === "road") {
        if (!(await isRoadRaceOfInterest(race.raceEventId, race.uciCategory))) continue;
      } else if (!isMtbEligible(race)) continue;

      const prompt = await buildRacedayPrompt(race, discipline);
      if (!prompt) continue;

      const text = await generate(prompt);
      if (!text) continue;

      const sent = await sendToWA(groupJid, text);
      if (sent) await markPosted(race.id, "wa-raceday", channel);
      results.push({ race: race.eventName ?? race.name, discipline, type: "raceday", status: sent ? "posted" : "send_failed" });
    }

    // ── RESULTS: completed in last 2 days ─────────────────────────
    const completedRaces = deduplicateByEvent(await getCompletedRaces(discipline));
    for (const race of completedRaces.slice(0, 3)) {
      if (await hasBeenPosted(race.id, "wa-result", channel)) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "result", status: "already_posted" });
        continue;
      }

      if (discipline === "road") {
        if (!(await isRoadRaceOfInterest(race.raceEventId, race.uciCategory))) continue;
      } else if (!isMtbEligible(race)) continue;

      const prompt = await buildResultPrompt(race, discipline);
      if (!prompt) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "result", status: "not_enough_results" });
        continue;
      }

      const text = await generate(prompt);
      if (!text) continue;

      const sent = await sendToWA(groupJid, text);
      if (sent) await markPosted(race.id, "wa-result", channel);
      results.push({ race: race.eventName ?? race.name, discipline, type: "result", status: sent ? "posted" : "send_failed" });
    }
  }

  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Quiet hours: skip if UTC hour < 7 or > 21
  const utcHour = new Date().getUTCHours();
  if (utcHour < 7 || utcHour > 21) {
    return NextResponse.json({ success: true, message: "Quiet hours — skipped", utcHour });
  }

  try {
    const results = await processAllGroups();
    const posted = results.filter(r => r.status === "posted").length;

    return NextResponse.json({
      success: true,
      posted,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error("[cron/whatsapp-groups]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
