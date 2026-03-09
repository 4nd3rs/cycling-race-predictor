import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  raceEvents,
  raceStartlist,
  riders,
  predictions,
  userFollows,
  userTelegram,
  userWhatsapp,
  notificationLog,
  teams,
} from "@/lib/db";
import { eq, and, gte, lte, inArray, asc, desc } from "drizzle-orm";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageType = "preview" | "raceday" | "result";

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
};

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

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
  followedRiders: Array<{ name: string; predictedPosition: number | null; teamName: string | null }>,
  raceUrl: string,
): string {
  const isMTB = ["mtb", "xco"].includes(race.discipline);
  const dateStr = new Date(new Date(race.date).getTime() + 12 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });

  const predictionsText = topPreds.slice(0, 5)
    .map((p, i) => `${i + 1}. ${normalizeName(p.riderName)} — ${(p.winProb * 100).toFixed(0)}%`)
    .join("\n");

  const followedText = followedRiders.length > 0
    ? followedRiders.map(r => {
        const parts = [normalizeName(r.name)];
        if (r.teamName) parts.push(`(${r.teamName})`);
        if (r.predictedPosition) parts.push(`— predicted #${r.predictedPosition}`);
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
- One sentence on who won and how
- Numbered results list (up to 5)
- For EACH followed rider: how they finished vs their predicted position
- End with the URL
- Length: 80-120 words`,
  };

  return `You are a passionate cycling expert writing a personalized race update for a specific fan. This message should feel like it's written FOR them — their riders are the main story.

RACE: ${race.eventName} — ${race.raceName}
DATE: ${dateStr}
${race.country ? `COUNTRY: ${race.country}` : ""}
${race.uciCategory ? `CATEGORY: ${race.uciCategory}` : ""}
DISCIPLINE: ${isMTB ? "Mountain Bike" : "Road"}
URL: ${raceUrl}

TOP 5 PREDICTIONS (all confirmed on the startlist):
${predictionsText || "No predictions yet"}

USER'S FOLLOWED RIDERS IN THIS RACE (confirmed on startlist):
${followedText}
${followedRiders.length === 0 ? "(User follows this race event but none of their specific riders are on the startlist)" : ""}

CRITICAL RULES:
- ONLY mention riders who are listed above. Do NOT invent or assume any rider is racing.
- Every followed rider listed above MUST be mentioned by name in the message.
- This is personalized — the followed riders section is the most important part of the message.

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

    // Race datetime assumed to be noon UTC on race day
    const raceTime = new Date(r.date).getTime() + 12 * 60 * 60 * 1000; // midnight local + 12h ≈ noon race time
    const hoursUntilRace = (raceTime - now) / (60 * 60 * 1000);
    const hoursSinceRace = -hoursUntilRace;

    let messageType: MessageType | null = null;

    if (hoursUntilRace >= 36 && hoursUntilRace <= 60) {
      messageType = "preview";
    } else if (hoursUntilRace >= 0 && hoursUntilRace <= 6) {
      messageType = "raceday";
    }
    // Note: "result" type is handled by results-hunter cron (uses real data, not AI predictions)

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

  // Resolve team follows → rider IDs on this startlist
  const teamToRiders = new Map<string, string[]>();
  for (const s of startlist) {
    if (s.teamId) {
      if (!teamToRiders.has(s.teamId)) teamToRiders.set(s.teamId, []);
      teamToRiders.get(s.teamId)!.push(s.riderId);
    }
  }

  // Group by user
  const userMap = new Map<string, { riderIds: Set<string>; teamIds: string[]; followsEvent: boolean }>();
  for (const row of followRows) {
    if (!userMap.has(row.userId)) userMap.set(row.userId, { riderIds: new Set(), teamIds: [], followsEvent: false });
    const e = userMap.get(row.userId)!;
    if (row.followType === "rider") {
      e.riderIds.add(row.entityId);
    } else if (row.followType === "team") {
      e.teamIds.push(row.entityId);
      // Also add the team's riders from the startlist as followed
      const teamRiders = teamToRiders.get(row.entityId) || [];
      for (const rid of teamRiders) e.riderIds.add(rid);
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

    // Get followed rider predictions — only riders actually on the startlist
    const followedRiderIds = [...data.riderIds].filter(id => startlistIds.has(id));
    let followedRiders: Array<{ name: string; predictedPosition: number | null; teamName: string | null }> = [];
    if (followedRiderIds.length > 0) {
      const riderPreds = await db
        .select({
          name: riders.name,
          pos: predictions.predictedPosition,
          teamName: teams.name,
        })
        .from(riders)
        .leftJoin(predictions, and(eq(predictions.raceId, race.raceId), eq(predictions.riderId, riders.id)))
        .leftJoin(teams, eq(riders.teamId, teams.id))
        .where(inArray(riders.id, followedRiderIds));
      followedRiders = riderPreds.map(r => ({ name: r.name, predictedPosition: r.pos, teamName: r.teamName }));
    }

    const prompt = buildPrompt(
      race,
      topPreds.map(p => ({
        riderName: p.riderName,
        position: p.position,
        winProb: parseFloat(String(p.winProb || "0")),
      })),
      followedRiders,
      raceUrl,
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

    if (candidates.length === 0) {
      return NextResponse.json({ success: true, message: "No races to notify about" });
    }

    let totalSent = 0, totalSkipped = 0, totalDupes = 0;
    const raceSummaries: Array<{ race: string; type: string; sent: number }> = [];

    for (const race of candidates) {
      const result = await processRace(race);
      totalSent += result.sent;
      totalSkipped += result.skipped;
      totalDupes += result.dupes;
      raceSummaries.push({ race: race.eventName, type: race.messageType, sent: result.sent });
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