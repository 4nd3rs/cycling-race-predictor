/**
 * POST/GET /api/cron/whatsapp-groups
 * Posts race previews, raceday hype, results, news digests, and breaking alerts
 * to WhatsApp groups via the Fly.io gateway.
 * Covers both Road and MTB disciplines.
 * Runs every 2 hours — each run checks all windows and posts what's needed.
 */
import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
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
  riderRumours,
} from "@/lib/db";
import { eq, and, gte, lte, desc, asc, inArray, isNotNull, sql } from "drizzle-orm";

export const maxDuration = 60;

const APP_URL = "https://procyclingpredictor.com";
const ROAD_GROUP = "120363425402092416@g.us";
const MTB_GROUP = "120363405998540593@g.us";

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

type PostType = "wa-preview" | "wa-raceday" | "wa-result" | "wa-news" | "wa-breaking";

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

async function buildPreviewPost(race: RaceRow, discipline: string): Promise<string | null> {
  const preds = await getTopPredictions(race.id, 3);
  if (preds.length === 0) return null;

  const url = raceUrl(discipline, race.eventSlug);
  const isMtb = discipline === "mtb";
  const emoji = isMtb ? "🚵" : "🏁";
  const dateStr = parseDate(race.date);
  const picks = preds.map((p, i) => `${i + 1}. *${p.name}*${p.team ? ` (${p.team})` : ""}`).join("\n");

  const prompt = `You write punchy WhatsApp race preview messages for Pro Cycling Predictor.
Write ONLY a 2-3 sentence race preview blurb for ${race.eventName ?? race.name} (${dateStr}).
Focus on what makes this race interesting and what to watch for.
Sound like a knowledgeable cycling fan, not a press release. No hashtags. Max 60 words.
Do NOT mention any rider names or predictions — those will be added separately.`;

  const blurb = await generate(prompt);
  if (!blurb) return null;

  return `${emoji} *${race.eventName ?? race.name}* — ${dateStr}
${blurb}

🔮 *Our top picks:*
${picks}

👉 Full preview: ${url}`;
}

async function buildRacedayPost(race: RaceRow, discipline: string): Promise<string | null> {
  const preds = await getTopPredictions(race.id, 3);
  if (preds.length === 0) return null;

  const url = raceUrl(discipline, race.eventSlug);
  const isMtb = discipline === "mtb";
  const emoji = isMtb ? "🚵" : "🚴";
  const picks = preds.map((p, i) => `${i + 1}. *${p.name}*`).join("\n");

  const prompt = `Write a single punchy race-day hype sentence (max 30 words) for ${race.eventName ?? race.name}.
Sound like a knowledgeable cycling fan. No hashtags. Do NOT mention any rider names — those will be added separately.`;

  const blurb = await generate(prompt);

  return `${emoji} *${race.eventName ?? race.name}* — Race day!
${blurb ?? "It's go time."}

🔮 *Our picks:*
${picks}

👉 ${url}`;
}

async function buildResultPost(race: RaceRow, discipline: string): Promise<string | null> {
  const results = await getRecentResults(race.id);
  if (results.length < 3) return null;

  const podium = results.slice(0, 3).map((r, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    return `${medal} *${r.riderName}*${r.teamName ? ` (${r.teamName})` : ""}`;
  }).join("\n");
  const url = raceUrl(discipline, race.eventSlug);
  const winner = results[0]?.riderName ?? "unknown";

  const prompt = `Write a single punchy sentence (max 30 words) about *${winner}* winning ${race.eventName ?? race.name}.
Sound like a knowledgeable cycling fan. No hashtags. Do NOT list any rider names or results — those will be added separately.`;

  const blurb = await generate(prompt);

  return `🏆 *${race.eventName ?? race.name}* — Result

${podium}

${blurb ?? ""}

📊 Updated rankings: ${url}`;
}

// ── News prompt builders ─────────────────────────────────────────────────────

async function buildRoadNewsPrompt(): Promise<string | null> {
  // Get upcoming road races in next 7 days
  const upcoming = await getRaces("road", 0, 7);
  const deduped = deduplicateByEvent(upcoming);
  if (deduped.length === 0) return null;

  const racesText = deduped.slice(0, 5).map(r =>
    `- ${r.eventName ?? r.name}: ${parseDate(r.date)} (${r.uciCategory ?? "UCI"})`
  ).join("\n");

  const raceLinks = deduped.filter(r => r.eventSlug).slice(0, 3).map(r =>
    `${r.eventName ?? r.name} → ${APP_URL}/races/road/${r.eventSlug}`
  );

  // Get recent rumours for breaking-style intel
  const recentRumours = await db.select({
    riderName: riders.name,
    summary: riderRumours.summary,
    sentiment: riderRumours.aggregateScore,
  })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(gte(riderRumours.lastUpdated, new Date(Date.now() - 48 * 60 * 60 * 1000)))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(5);

  const intelText = recentRumours.length > 0
    ? recentRumours.map(r => `- ${r.riderName}: ${r.summary}`).join("\n")
    : "No recent rider news";

  return `You write punchy WhatsApp messages for a pro cycling predictions app called Pro Cycling Predictor.
Write a short, engaging WhatsApp message (max 130 words) about what's happening in road cycling this week.
Use *bold* for names and race names. No hashtags. Max 2-3 emojis.

Upcoming races this week:
${racesText}

Latest rider intel:
${intelText}

Race pages you can link to (ONLY link races you actually mention):
${raceLinks.length > 0 ? raceLinks.join("\n") : "No race pages available — do NOT add any link."}

Rules:
- Conversational, like a knowledgeable cycling fan
- Lead with the most interesting thing
- If a race is today or tomorrow, make that the focus
- End with 👉 link to the most relevant race you mentioned (only if it has a page above)`;
}

async function buildMtbNewsPrompt(): Promise<string | null> {
  const upcoming = await getRaces("mtb", 0, 14);
  const deduped = deduplicateByEvent(upcoming);
  const eligible = deduped.filter(r => isMtbEligible(r));
  if (eligible.length === 0) return null;

  const racesText = eligible.slice(0, 3).map(r =>
    `- ${r.eventName ?? r.name} (${r.country ?? "?"}, ${parseDate(r.date)}, ${r.uciCategory ?? "UCI"})`
  ).join("\n");

  const raceLinks = eligible.filter(r => r.eventSlug).slice(0, 3).map(r =>
    `${r.eventName ?? r.name} → ${APP_URL}/races/mtb/${r.eventSlug}`
  ).join("\n");

  return `You write punchy WhatsApp messages for a pro cycling predictions app called Pro Cycling Predictor.
Write a short, engaging MTB weekly roundup (max 120 words).
Use *bold* for names and race names. No hashtags. Max 2 emojis. No markdown headers.

Upcoming MTB races:
${racesText}

Race links (ONLY link races you mention):
${raceLinks || "No links — do NOT add any."}

Rules:
- Conversational, like a knowledgeable MTB fan
- Focus on the biggest upcoming race
- If WorldCup or Continental Champs — highlight it
- End with 👉 link to most relevant race (only if available above)`;
}

// ── Breaking news detection ──────────────────────────────────────────────────

const BREAKING_KEYWORDS = [
  "withdraw", "abandon", "sick", "ill", "injur", "crash", "surgery",
  "out of", "scratched", "DNS", "DNF", "not start", "pulled out", "forced to",
  "fracture", "broken", "hospital", "sidelined",
];

function isBreakingRumour(summary: string | null, sentiment: string | null): boolean {
  if (!summary) return false;
  const text = summary.toLowerCase();
  if (BREAKING_KEYWORDS.some(k => text.includes(k))) return true;
  if (sentiment !== null && parseFloat(sentiment) < -0.3) return true;
  return false;
}

async function getBreakingRumours(): Promise<Array<{ riderId: string; riderName: string; summary: string }>> {
  // Get rumours updated in last 4 hours with negative/breaking content
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const rumours = await db.select({
    riderId: riderRumours.riderId,
    riderName: riders.name,
    summary: riderRumours.summary,
    sentiment: riderRumours.aggregateScore,
  })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(gte(riderRumours.lastUpdated, cutoff))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(10);

  return rumours
    .filter(r => isBreakingRumour(r.summary, r.sentiment))
    .map(r => ({ riderId: r.riderId, riderName: r.riderName ?? "Unknown", summary: r.summary ?? "" }));
}

async function buildBreakingPrompt(riderName: string, summary: string, raceLink: string): Promise<string> {
  return `You write urgent cycling news alerts for WhatsApp (Pro Cycling Predictor group).
Write a short, punchy breaking news message (max 80 words) about this:

Rider: ${riderName}
Intel: ${summary}

Use ⚠️ emoji to open. *Bold* the rider name. Say what it means for upcoming races if relevant.
${raceLink ? `End with: ${raceLink}` : "Do NOT add any link."}
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

      const text = await buildPreviewPost(race, discipline);
      if (!text) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "preview", status: "no_predictions" });
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

      const text = await buildRacedayPost(race, discipline);
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

      const text = await buildResultPost(race, discipline);
      if (!text) {
        results.push({ race: race.eventName ?? race.name, discipline, type: "result", status: "not_enough_results" });
        continue;
      }

      const sent = await sendToWA(groupJid, text);
      if (sent) await markPosted(race.id, "wa-result", channel);
      results.push({ race: race.eventName ?? race.name, discipline, type: "result", status: sent ? "posted" : "send_failed" });
    }

    // ── NEWS DIGEST: once per day per discipline ─────────────────
    // Road: post around midday UTC (10-14). MTB: Mondays only.
    const utcHour = new Date().getUTCHours();
    const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon
    const newsKey = `news-${dayStr(0)}`;
    const shouldPostNews =
      discipline === "road" ? (utcHour >= 10 && utcHour <= 14) :
      discipline === "mtb" ? (dayOfWeek === 1 && utcHour >= 8 && utcHour <= 12) :
      false;

    if (shouldPostNews && !(await hasBeenPosted(newsKey, "wa-news", channel))) {
      const newsPrompt = discipline === "road"
        ? await buildRoadNewsPrompt()
        : await buildMtbNewsPrompt();

      if (newsPrompt) {
        const text = await generate(newsPrompt);
        if (text) {
          const sent = await sendToWA(groupJid, text);
          if (sent) await markPosted(newsKey, "wa-news", channel);
          results.push({ race: `${discipline}-news`, discipline, type: "news", status: sent ? "posted" : "send_failed" });
        }
      } else {
        results.push({ race: `${discipline}-news`, discipline, type: "news", status: "no_content" });
      }
    }

    // ── BREAKING NEWS: urgent rider alerts ───────────────────────
    if (discipline === "road") {
      const breaking = await getBreakingRumours();
      for (const item of breaking.slice(0, 2)) {
        const breakingKey = `breaking-${item.riderId}-${dayStr(0)}`;
        if (await hasBeenPosted(breakingKey, "wa-breaking", channel)) continue;

        // Find if rider is on an upcoming startlist to link to that race
        const startlistRace = await db.select({
          eventSlug: raceEvents.slug,
        })
          .from(raceStartlist)
          .innerJoin(races, eq(raceStartlist.raceId, races.id))
          .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
          .where(and(
            eq(raceStartlist.riderId, item.riderId),
            gte(races.date, dayStr(-1)),
            lte(races.date, dayStr(14)),
          ))
          .limit(1);

        const raceLink = startlistRace[0]?.eventSlug
          ? `👉 ${APP_URL}/races/road/${startlistRace[0].eventSlug}`
          : "";

        const prompt = await buildBreakingPrompt(item.riderName, item.summary, raceLink);
        const text = await generate(prompt);
        if (!text) continue;

        const sent = await sendToWA(groupJid, text);
        if (sent) await markPosted(breakingKey, "wa-breaking", channel);
        results.push({ race: `breaking-${item.riderName}`, discipline, type: "breaking", status: sent ? "posted" : "send_failed" });
      }
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
