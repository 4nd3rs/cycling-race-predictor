import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  db,
  races,
  raceEvents,
  raceStartlist,
  raceResults,
  riders,
  predictions,
  userFollows,
  userTelegram,
  userWhatsapp,
  notificationLog,
  teams,
  riderRumours,
} from "@/lib/db";
import { eq, and, gte, lte, inArray, asc, desc, isNotNull, sql } from "drizzle-orm";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageType = "preview" | "raceday" | "result" | "news";

interface RaceCandidate {
  raceId: string;
  raceName: string;
  eventName: string;
  discipline: string;
  uciCategory: string | null;
  country: string | null;
  date: string;
  raceEventId: string;
  eventSlug: string | null;
  categorySlug: string | null;
  messageType: MessageType;
}

// ── Frequency gates ───────────────────────────────────────────────────────────

const FREQUENCY_GATES: Record<MessageType, string[]> = {
  preview: ["all", "key-moments"],
  raceday: ["all"],
  result: ["all", "key-moments", "race-day-only"],
  news: ["all", "key-moments"],
};

// ── Sending ───────────────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return res.ok;
}

async function sendWhatsApp(phone: string, text: string): Promise<boolean> {
  const gw = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!gw || !token) return false;
  try {
    const res = await fetch(`${gw}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: phone, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function toWhatsAppFormat(text: string): string {
  // Convert HTML bold to WhatsApp bold
  return text.replace(/<b>/g, "*").replace(/<\/b>/g, "*");
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

async function alreadySent(userId: string, raceId: string, type: MessageType, channel: string): Promise<boolean> {
  const row = await db.query.notificationLog.findFirst({
    where: and(
      eq(notificationLog.userId, userId),
      eq(notificationLog.entityId, raceId),
      eq(notificationLog.eventType, type),
      eq(notificationLog.channel, channel),
    ),
  });
  return !!row;
}

async function logSent(userId: string, raceId: string, type: MessageType, channel: string) {
  await db.insert(notificationLog).values({
    userId,
    channel,
    eventType: type,
    entityId: raceId,
  }).onConflictDoNothing();
}

// ── Message generation via Gemini ─────────────────────────────────────────────

function normalizeName(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  if (last === last.toUpperCase() || parts[0] === parts[0].toUpperCase()) {
    const firstName = parts[parts.length - 1];
    const lastName = parts.slice(0, -1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    return `${firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()} ${lastName}`;
  }
  return name;
}

function buildPrompt(
  race: RaceCandidate,
  topPreds: Array<{ riderName: string; position: number | null; winProb: number }>,
  followedRiders: Array<{ name: string; predictedPosition: number | null; actualPosition: number | null; teamName: string | null }>,
  followedTeams: Array<{ teamName: string; riderCount: number; raceUrl: string }>,
  raceUrl: string,
  actualResults: Array<{ position: number | null; riderName: string; teamName: string | null }> = [],
): string {
  const isMTB = ["mtb", "xco"].includes(race.discipline);
  const dateStr = new Date(new Date(race.date).getTime() + 12 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });

  const predictionsText = topPreds.slice(0, 5)
    .map((p, i) => `${i + 1}. ${normalizeName(p.riderName)} — ${(p.winProb * 100).toFixed(0)}%`)
    .join("\n");

  const resultsText = actualResults.slice(0, 5)
    .map(r => `${r.position}. ${normalizeName(r.riderName)}${r.teamName ? ` (${r.teamName})` : ""}`)
    .join("\n");

  const followedText = followedRiders.length > 0
    ? followedRiders.map(r => {
        const parts = [normalizeName(r.name)];
        if (r.teamName) parts.push(`(${r.teamName})`);
        if (r.actualPosition) parts.push(`— finished #${r.actualPosition}`);
        if (r.predictedPosition) parts.push(`(predicted #${r.predictedPosition})`);
        return parts.join(" ");
      }).join("\n")
    : "None";

  const typeInstructions: Record<MessageType, string> = {
    preview: `Write a race PREVIEW message (T-2 days).
- Start with a bold header line: the race name and stage
- One sentence on what makes this race/stage special
- List the top 5 predictions with a short phrase per rider
- IMPORTANT: Dedicate a personal section to EACH of the user's followed riders who are racing:
  - Mention each by name with their predicted position and team
  - Add one sentence of context: their form, role in the race, what to expect
  - If a rider is predicted outside top 20, still mention them positively (e.g. breakaway potential, domestique role, gaining experience)
- End with the URL on its own line
- Length: 100-180 words`,
    raceday: `Write a RACE DAY morning message.
- Bold header with race name
- Short and punchy — this is race morning
- Mention each of the user's followed riders and what to watch for them today
- One key tactical insight
- End with the URL
- Length: 60-100 words`,
    result: `Write a RESULTS message after the race.
- Bold header with race name + "Result"
- One sentence on who won and how
- Numbered results list (top 5)
- For EACH followed rider: how they actually finished vs their predicted position. Celebrate good results, commiserate bad ones.
- End with the URL
- Length: 80-120 words`,
    news: `Write a brief NEWS/INTEL update.
- This is handled separately — not used in buildPrompt.`,
  };

  return `You are a passionate cycling expert writing a personalized race update for a specific fan. This message should feel like it's written FOR them — their riders are the main story.

RACE: ${race.eventName} — ${race.raceName}
DATE: ${dateStr}
${race.country ? `COUNTRY: ${race.country}` : ""}
${race.uciCategory ? `CATEGORY: ${race.uciCategory}` : ""}
DISCIPLINE: ${isMTB ? "Mountain Bike" : "Road"}
URL: ${raceUrl}

${race.messageType === "result" ? `ACTUAL RESULTS (top 5):
${resultsText || "No results yet"}

OUR PREDICTIONS WERE:
${predictionsText || "No predictions"}` : `TOP 5 PREDICTIONS (all confirmed on the startlist):
${predictionsText || "No predictions yet"}`}

USER'S FOLLOWED RIDERS IN THIS RACE (confirmed on startlist):
${followedText}
${followedRiders.length === 0 && followedTeams.length === 0 ? "(User follows this race event but none of their specific riders or teams are on the startlist)" : ""}
${followedTeams.length > 0 ? `
USER'S FOLLOWED TEAMS IN THIS RACE:
${followedTeams.map(t => `${t.teamName} — ${t.riderCount} riders on the startlist (race link: ${t.raceUrl})`).join("\n")}
` : ""}
CRITICAL RULES:
- ONLY mention riders who are listed above. Do NOT invent or assume any rider is racing.
- Every followed rider listed above MUST be mentioned by name in the message.
- If a followed team is listed, mention the team by name and include the race link. Keep it brief — just note they're racing here with X riders.
- This is personalized — the followed riders and teams sections are the most important parts of the message.

TONE GUIDE:
- Write like a knowledgeable cycling analyst talking directly to a fan about their riders
- Use cycling vocabulary naturally (rouleur, puncheur, parcours, bergs, cobbles)
- Use "I predict", "I have X here" — first person singular
- Dry, understated European tone — confident but not breathless
- No corporate language. No "Hi!" openers. No excessive emoji. No hashtags.
- ${isMTB ? "For MTB: emphasise course conditions, first lap importance, top 3 only" : "For road: emphasise terrain suitability, tactics, weather impact"}

FORMAT: Plain text. Use *bold* (asterisks) for emphasis. No markdown headers.

MESSAGE TYPE: ${typeInstructions[race.messageType]}

Write ONLY the message text. No preamble. No quotes. Start directly with content. End with the URL.`;
}

async function generateMessage(prompt: string): Promise<{ html: string; plain: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!raw) return null;

  // Telegram version: bold the first line
  const lines = raw.split("\n");
  const htmlLines = lines.map((l: string, i: number) => (i === 0 && l.trim() ? `<b>${l.trim()}</b>` : l));

  return { html: htmlLines.join("\n"), plain: raw };
}

// ── Find races to notify about ────────────────────────────────────────────────

async function findRaceCandidates(): Promise<RaceCandidate[]> {
  const now = Date.now();
  const candidates: RaceCandidate[] = [];

  // All active races in a wide window (yesterday to 3 days out)
  const windowStart = new Date(now - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(now + 60 * 60 * 60 * 1000).toISOString().slice(0, 10); // 60h

  const raceRows = await db
    .select({
      raceId: races.id,
      raceName: races.name,
      date: races.date,
      discipline: races.discipline,
      uciCategory: races.uciCategory,
      raceEventId: races.raceEventId,
      categorySlug: races.categorySlug,
      eventName: raceEvents.name,
      country: raceEvents.country,
      eventSlug: raceEvents.slug,
      eventDiscipline: raceEvents.discipline,
    })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.status, "active"),
      gte(races.date, windowStart),
      lte(races.date, windowEnd),
    ))
    .orderBy(asc(races.date));

  for (const r of raceRows) {
    if (!r.date || !r.raceEventId) continue;

    const raceTime = new Date(r.date).getTime() + 12 * 60 * 60 * 1000;
    const hoursUntilRace = (raceTime - now) / (60 * 60 * 1000);

    let messageType: MessageType | null = null;

    if (hoursUntilRace >= 36 && hoursUntilRace <= 60) {
      messageType = "preview";
    } else if (hoursUntilRace >= 0 && hoursUntilRace <= 6) {
      messageType = "raceday";
    }

    if (messageType) {
      candidates.push({
        raceId: r.raceId,
        raceName: r.raceName,
        eventName: r.eventName,
        discipline: r.eventDiscipline || r.discipline || "road",
        uciCategory: r.uciCategory,
        country: r.country,
        date: r.date,
        raceEventId: r.raceEventId,
        eventSlug: r.eventSlug,
        categorySlug: r.categorySlug,
        messageType,
      });
    }
  }

  // ── Result candidates: completed races with 3+ results in last 48h ──────
  const resultWindowStart = new Date(now - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const completedRows = await db
    .select({
      raceId: races.id,
      raceName: races.name,
      date: races.date,
      discipline: races.discipline,
      uciCategory: races.uciCategory,
      raceEventId: races.raceEventId,
      categorySlug: races.categorySlug,
      eventName: raceEvents.name,
      country: raceEvents.country,
      eventSlug: raceEvents.slug,
      eventDiscipline: raceEvents.discipline,
    })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.status, "completed"),
      gte(races.date, resultWindowStart),
    ))
    .orderBy(desc(races.date));

  for (const r of completedRows) {
    if (!r.date || !r.raceEventId) continue;
    // Check it has enough results
    const resultCount = await db.select({ count: sql<number>`count(*)` })
      .from(raceResults)
      .where(and(eq(raceResults.raceId, r.raceId), isNotNull(raceResults.position)));
    if (Number(resultCount[0]?.count ?? 0) < 3) continue;

    candidates.push({
      raceId: r.raceId,
      raceName: r.raceName,
      eventName: r.eventName,
      discipline: r.eventDiscipline || r.discipline || "road",
      uciCategory: r.uciCategory,
      country: r.country,
      date: r.date,
      raceEventId: r.raceEventId,
      eventSlug: r.eventSlug,
      categorySlug: r.categorySlug,
      messageType: "result",
    });
  }

  return candidates;
}

// ── Process one race ──────────────────────────────────────────────────────────

async function processRace(race: RaceCandidate): Promise<{ sent: number; skipped: number; dupes: number }> {
  let sent = 0, skipped = 0, dupes = 0;

  // Get startlist with rider info and team
  const startlist = await db
    .select({
      riderId: raceStartlist.riderId,
      teamId: raceStartlist.teamId,
    })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, race.raceId));
  const startlistIds = new Set(startlist.map(s => s.riderId));
  const startlistTeamIds = new Set(startlist.map(s => s.teamId).filter(Boolean) as string[]);

  // Find followers: race_event follows + rider follows (only riders on startlist) + team follows (only teams on startlist)
  let followRows = await db
    .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, "race_event"), eq(userFollows.entityId, race.raceEventId)));

  if (startlistIds.size > 0) {
    const riderFollows = await db
      .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
      .from(userFollows)
      .where(and(eq(userFollows.followType, "rider"), inArray(userFollows.entityId, [...startlistIds])));
    followRows = [...followRows, ...riderFollows];
  }

  if (startlistTeamIds.size > 0) {
    const teamFollows = await db
      .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
      .from(userFollows)
      .where(and(eq(userFollows.followType, "team"), inArray(userFollows.entityId, [...startlistTeamIds])));
    followRows = [...followRows, ...teamFollows];
  }

  if (followRows.length === 0) return { sent: 0, skipped: 0, dupes: 0 };

  // Group by user — keep rider follows and team follows separate
  const userMap = new Map<string, { riderIds: Set<string>; teamIds: string[]; followsEvent: boolean }>();
  for (const row of followRows) {
    if (!userMap.has(row.userId)) userMap.set(row.userId, { riderIds: new Set(), teamIds: [], followsEvent: false });
    const e = userMap.get(row.userId)!;
    if (row.followType === "rider") {
      e.riderIds.add(row.entityId);
    } else if (row.followType === "team") {
      e.teamIds.push(row.entityId);
    } else {
      e.followsEvent = true;
    }
  }

  // Top 5 predictions — only riders actually on the startlist
  const topPreds = startlistIds.size > 0
    ? await db
        .select({
          position: predictions.predictedPosition,
          winProb: predictions.winProbability,
          riderName: riders.name,
          riderId: predictions.riderId,
        })
        .from(predictions)
        .innerJoin(riders, eq(predictions.riderId, riders.id))
        .where(and(
          eq(predictions.raceId, race.raceId),
          inArray(predictions.riderId, [...startlistIds]),
        ))
        .orderBy(asc(predictions.predictedPosition))
        .limit(5)
    : [];

  // For result messages: fetch actual results
  let actualResults: Array<{ position: number | null; riderName: string; riderId: string; teamName: string | null }> = [];
  if (race.messageType === "result") {
    actualResults = await db
      .select({
        position: raceResults.position,
        riderName: riders.name,
        riderId: raceResults.riderId,
        teamName: teams.name,
      })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .leftJoin(teams, eq(raceResults.teamId, teams.id))
      .where(and(eq(raceResults.raceId, race.raceId), isNotNull(raceResults.position)))
      .orderBy(asc(raceResults.position))
      .limit(10);
  }

  const raceUrl = race.eventSlug
    ? `https://procyclingpredictor.com/races/${race.discipline}/${race.eventSlug}${race.categorySlug ? `/${race.categorySlug}` : ""}`
    : "https://procyclingpredictor.com";

  // Get contacts for all users in this race
  const userIds = Array.from(userMap.keys());
  const tgRows = await db.select({ userId: userTelegram.userId, chatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(inArray(userTelegram.userId, userIds));

  const tgByUser = new Map(tgRows.filter(r => r.chatId).map(r => [r.userId, r.chatId!]));

  const waRows = await db.select({
    userId: userWhatsapp.userId,
    phone: userWhatsapp.phoneNumber,
    frequency: userWhatsapp.notificationFrequency,
  }).from(userWhatsapp).where(inArray(userWhatsapp.userId, userIds));

  const waByUser = new Map(waRows.filter(r => r.phone).map(r => [r.userId, r]));

  // Build send tasks
  type SendTask = { type: "telegram" | "whatsapp"; fn: () => Promise<void> };
  const tgTasks: SendTask[] = [];
  const waTasks: SendTask[] = [];

  for (const [userId, data] of userMap) {
    const hasTg = tgByUser.has(userId);
    const waContact = waByUser.get(userId);
    const hasWa = waContact && waContact.frequency !== "off" &&
      FREQUENCY_GATES[race.messageType].includes(waContact.frequency!);
    if (!hasTg && !hasWa) { skipped++; continue; }

    // Get followed rider info — only riders actually on the startlist (or in results)
    const relevantRiderIds = race.messageType === "result"
      ? [...data.riderIds].filter(id => actualResults.some(r => r.riderId === id) || startlistIds.has(id))
      : [...data.riderIds].filter(id => startlistIds.has(id));
    let followedRiders: Array<{ name: string; predictedPosition: number | null; actualPosition: number | null; teamName: string | null }> = [];
    if (relevantRiderIds.length > 0) {
      const riderPreds = await db
        .select({
          id: riders.id,
          name: riders.name,
          pos: predictions.predictedPosition,
          teamName: teams.name,
        })
        .from(riders)
        .leftJoin(predictions, and(eq(predictions.raceId, race.raceId), eq(predictions.riderId, riders.id)))
        .leftJoin(teams, eq(riders.teamId, teams.id))
        .where(inArray(riders.id, relevantRiderIds));
      followedRiders = riderPreds.map(r => {
        const actual = actualResults.find(a => a.riderId === r.id);
        return { name: r.name, predictedPosition: r.pos, actualPosition: actual?.position ?? null, teamName: r.teamName };
      });
    }

    // Get followed team info — team name + number of riders on startlist
    let followedTeams: Array<{ teamName: string; riderCount: number; raceUrl: string }> = [];
    if (data.teamIds.length > 0) {
      for (const teamId of data.teamIds) {
        const teamInfo = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
        const riderCount = startlist.filter(s => s.teamId === teamId).length;
        if (teamInfo.length > 0 && riderCount > 0) {
          followedTeams.push({ teamName: teamInfo[0].name, riderCount, raceUrl });
        }
      }
    }

    const prompt = buildPrompt(
      race,
      topPreds.map(p => ({
        riderName: p.riderName,
        position: p.position,
        winProb: parseFloat(String(p.winProb || "0")),
      })),
      followedRiders,
      followedTeams,
      raceUrl,
      actualResults.map(r => ({ position: r.position, riderName: r.riderName, teamName: r.teamName })),
    );

    // Telegram send task
    if (hasTg) {
      tgTasks.push({ type: "telegram", fn: async () => {
        const chatId = tgByUser.get(userId)!;
        if (await alreadySent(userId, race.raceId, race.messageType, "telegram")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const ok = await sendTelegram(chatId, msg.html);
        if (ok) { await logSent(userId, race.raceId, race.messageType, "telegram"); sent++; }
        else { skipped++; }
      }});
    }

    // WhatsApp send task
    if (hasWa) {
      waTasks.push({ type: "whatsapp", fn: async () => {
        if (await alreadySent(userId, race.raceId, race.messageType, "whatsapp")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const waText = toWhatsAppFormat(msg.plain);
        const ok = await sendWhatsApp(waContact!.phone!, waText);
        if (ok) { await logSent(userId, race.raceId, race.messageType, "whatsapp"); sent++; }
        else { skipped++; }
      }});
    }
  }

  // Execute Telegram tasks in batches of 20 (parallel, fast)
  for (let i = 0; i < tgTasks.length; i += 20) {
    const batch = tgTasks.slice(i, i + 20);
    await Promise.allSettled(batch.map(t => t.fn()));
  }

  // Execute WhatsApp tasks sequentially with 1.5s delay, time-boxed at 50s
  const waStart = Date.now();
  for (const task of waTasks) {
    if (Date.now() - waStart > 50_000) { skipped += waTasks.length; break; }
    await task.fn();
    await sleep(1500);
  }

  return { sent, skipped, dupes };
}

// ── News/Intel notifications ──────────────────────────────────────────────

async function processNews(): Promise<{ sent: number; skipped: number; dupes: number }> {
  let sent = 0, skipped = 0, dupes = 0;

  // Find recent rumours (last 24h) with strong sentiment
  const recentRumours = await db
    .select({
      riderId: riderRumours.riderId,
      riderName: riders.name,
      summary: riderRumours.summary,
      sentiment: riderRumours.aggregateScore,
      lastUpdated: riderRumours.lastUpdated,
    })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(gte(riderRumours.lastUpdated, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(20);

  if (recentRumours.length === 0) return { sent: 0, skipped: 0, dupes: 0 };

  const riderIdsWithNews = recentRumours.map(r => r.riderId);

  // Find users who follow these riders
  const followRows = await db
    .select({ userId: userFollows.userId, entityId: userFollows.entityId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, "rider"), inArray(userFollows.entityId, riderIdsWithNews)));

  if (followRows.length === 0) return { sent: 0, skipped: 0, dupes: 0 };

  // Also find users who follow teams of these riders
  const riderTeams = await db
    .select({ id: riders.id, teamId: riders.teamId })
    .from(riders)
    .where(inArray(riders.id, riderIdsWithNews));
  const riderTeamMap = new Map(riderTeams.filter(r => r.teamId).map(r => [r.teamId!, r.id]));

  if (riderTeamMap.size > 0) {
    const teamFollows = await db
      .select({ userId: userFollows.userId, entityId: userFollows.entityId })
      .from(userFollows)
      .where(and(eq(userFollows.followType, "team"), inArray(userFollows.entityId, [...riderTeamMap.keys()])));
    // Map team follows back to the rider with news
    for (const tf of teamFollows) {
      const riderId = riderTeamMap.get(tf.entityId);
      if (riderId) followRows.push({ userId: tf.userId, entityId: riderId });
    }
  }

  // Group: user → rider IDs with news
  const userRiders = new Map<string, Set<string>>();
  for (const f of followRows) {
    if (!userRiders.has(f.userId)) userRiders.set(f.userId, new Set());
    userRiders.get(f.userId)!.add(f.entityId);
  }

  // Get contacts
  const userIds = [...userRiders.keys()];
  const tgRows = await db.select({ userId: userTelegram.userId, chatId: userTelegram.telegramChatId })
    .from(userTelegram).where(inArray(userTelegram.userId, userIds));
  const tgByUser = new Map(tgRows.filter(r => r.chatId).map(r => [r.userId, r.chatId!]));

  const waRows = await db.select({
    userId: userWhatsapp.userId, phone: userWhatsapp.phoneNumber, frequency: userWhatsapp.notificationFrequency,
  }).from(userWhatsapp).where(inArray(userWhatsapp.userId, userIds));
  const waByUser = new Map(waRows.filter(r => r.phone).map(r => [r.userId, r]));

  const tgTasks: Array<() => Promise<void>> = [];
  const waTasks: Array<() => Promise<void>> = [];

  for (const [userId, riderIds] of userRiders) {
    const hasTg = tgByUser.has(userId);
    const waContact = waByUser.get(userId);
    const hasWa = waContact && waContact.frequency !== "off" && FREQUENCY_GATES.news.includes(waContact.frequency!);
    if (!hasTg && !hasWa) { skipped++; continue; }

    // Build news items for this user
    const userNews = recentRumours.filter(r => riderIds.has(r.riderId));
    if (userNews.length === 0) { skipped++; continue; }

    // Dedup key: combine rider IDs to avoid re-sending same news batch
    const dedupKey = `news-${new Date().toISOString().slice(0, 10)}-${[...riderIds].sort().join(",")}`;

    const newsText = userNews.map(r => {
      const sentiment = parseFloat(String(r.sentiment || "0"));
      const icon = sentiment >= 0.3 ? "📈" : sentiment <= -0.3 ? "⚠️" : "📰";
      return `${icon} *${normalizeName(r.riderName)}*: ${r.summary || "New intel available"}`;
    }).join("\n\n");

    const prompt = `You are a cycling news analyst writing a brief, personalized intel update for a fan.

The user follows these riders and there is fresh news about them:

${newsText}

Write a SHORT WhatsApp message (60-100 words max) that:
- Leads with the most impactful news item
- Covers each rider mentioned above
- Adds brief context on what this means for upcoming races
- Uses *bold* for rider names
- Dry, knowledgeable tone — like a trusted insider
- No "Hi!" openers, no corporate language, no hashtags
- End with: procyclingpredictor.com

Write ONLY the message text. No preamble.`;

    if (hasTg) {
      tgTasks.push(async () => {
        if (await alreadySent(userId, dedupKey, "news", "telegram")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const ok = await sendTelegram(tgByUser.get(userId)!, msg.html);
        if (ok) { await logSent(userId, dedupKey, "news", "telegram"); sent++; }
        else { skipped++; }
      });
    }

    if (hasWa) {
      waTasks.push(async () => {
        if (await alreadySent(userId, dedupKey, "news", "whatsapp")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const ok = await sendWhatsApp(waContact!.phone!, toWhatsAppFormat(msg.plain));
        if (ok) { await logSent(userId, dedupKey, "news", "whatsapp"); sent++; }
        else { skipped++; }
      });
    }
  }

  // Execute TG in parallel batches
  for (let i = 0; i < tgTasks.length; i += 20) {
    await Promise.allSettled(tgTasks.slice(i, i + 20).map(fn => fn()));
  }
  // Execute WA sequentially
  const waStart = Date.now();
  for (const task of waTasks) {
    if (Date.now() - waStart > 30_000) { skipped++; break; }
    await task();
    await sleep(1500);
  }

  return { sent, skipped, dupes };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Test mode: ?test=true — sends a real WA message to all connected users
  const url = new URL(request.url);
  // Quiet hours: skip if UTC hour < 7 or > 22
  const utcHour = new Date().getUTCHours();
  if (utcHour < 7 || utcHour > 22) {
    return NextResponse.json({ success: true, message: "Quiet hours — skipped", utcHour });
  }

  try {
    const candidates = await findRaceCandidates();

    let totalSent = 0, totalSkipped = 0, totalDupes = 0;
    const raceSummaries: Array<{ race: string; type: string; sent: number }> = [];

    for (const race of candidates) {
      const result = await processRace(race);
      totalSent += result.sent;
      totalSkipped += result.skipped;
      totalDupes += result.dupes;
      raceSummaries.push({ race: race.eventName, type: race.messageType, sent: result.sent });
    }

    // Process news/intel for followed riders
    const newsResult = await processNews();
    totalSent += newsResult.sent;
    totalSkipped += newsResult.skipped;
    totalDupes += newsResult.dupes;
    if (newsResult.sent > 0) {
      raceSummaries.push({ race: "rider-news", type: "news", sent: newsResult.sent });
    }

    return NextResponse.json({
      success: true,
      racesProcessed: candidates.length,
      totalSent,
      totalSkipped,
      totalDupes,
      races: raceSummaries,
    });
  } catch (error) {
    console.error("[cron/send-notifications]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}

// Test mode disabled