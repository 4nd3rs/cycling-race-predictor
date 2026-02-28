import { NextResponse } from "next/server";
import { headers } from "next/headers";
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

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER || "+16812710565";
  if (!sid || !token) return false;
  const normalized = to.startsWith("+") ? to : `+${to}`;
  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:${normalized}`,
    Body: text,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );
  return res.ok;
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
  followedRiders: Array<{ name: string; predictedPosition: number | null }>,
  raceUrl: string,
): string {
  const isMTB = ["mtb", "xco"].includes(race.discipline);
  const dateStr = new Date(race.date + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });

  const predictionsText = topPreds.slice(0, 5)
    .map((p, i) => `${i + 1}. ${normalizeName(p.riderName)} — ${(p.winProb * 100).toFixed(0)}%`)
    .join("\n");

  const followedText = followedRiders.length > 0
    ? followedRiders.map(r =>
        r.predictedPosition ? `${normalizeName(r.name)} — predicted ${r.predictedPosition}` : normalizeName(r.name)
      ).join("\n")
    : "None";

  const typeInstructions: Record<MessageType, string> = {
    preview: `Write a race PREVIEW message (T-2 days).
- One opening sentence on what makes this race special
- Numbered predictions list. Format: 1. Firstname Lastname — X% — one short distinctive phrase
- If a followed rider is NOT in the top 5, add one sentence mentioning where they sit
- End with the URL on its own line
- Length: 80-130 words`,
    raceday: `Write a RACE DAY morning message.
- Short and punchy — this is race morning
- One key insight or angle for today
- Max 50 words
- End with the URL`,
    result: `Write a RESULTS message after the race.
- One sentence on who won and how
- Numbered results list (up to 5)
- One line on followed riders: how they finished vs predicted
- End with the URL
- Length: 60-100 words`,
  };

  return `You are a passionate cycling expert writing personalized race updates for a fan.

RACE: ${race.eventName}
DATE: ${dateStr}
${race.country ? `COUNTRY: ${race.country}` : ""}
${race.uciCategory ? `CATEGORY: ${race.uciCategory}` : ""}
DISCIPLINE: ${isMTB ? "Mountain Bike" : "Road"}
URL: ${raceUrl}

TOP PREDICTIONS (our model):
${predictionsText || "No predictions yet"}

USER'S FOLLOWED RIDERS:
${followedText}

TONE GUIDE:
- Write like a knowledgeable cycling analyst — authoritative, fan-oriented
- Use cycling vocabulary naturally (rouleur, puncheur, parcours, bergs, cobbles)
- Use "I predict", "I have X here" — first person singular
- Dry, understated European tone — confident but not breathless
- No corporate language. No "Hi!" openers. No excessive emoji.
- ${isMTB ? "For MTB: emphasise course conditions, first lap importance, top 3 only" : "For road: emphasise terrain suitability, tactics, weather impact"}

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
    const raceTime = new Date(r.date + "T12:00:00Z").getTime();
    const hoursUntilRace = (raceTime - now) / (60 * 60 * 1000);
    const hoursSinceRace = -hoursUntilRace;

    let messageType: MessageType | null = null;

    if (hoursUntilRace >= 36 && hoursUntilRace <= 60) {
      messageType = "preview";
    } else if (hoursUntilRace >= 0 && hoursUntilRace <= 6) {
      messageType = "raceday";
    } else if (hoursSinceRace >= 0 && hoursSinceRace <= 12) {
      // Check if results exist
      const hasResults = await db.query.raceResults.findFirst({
        where: eq(raceResults.raceId, r.raceId),
      });
      if (hasResults) messageType = "result";
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

  return candidates;
}

// ── Process one race ──────────────────────────────────────────────────────────

async function processRace(race: RaceCandidate): Promise<{ sent: number; skipped: number; dupes: number }> {
  let sent = 0, skipped = 0, dupes = 0;

  // Get startlist rider IDs
  const startlist = await db
    .select({ riderId: raceStartlist.riderId })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, race.raceId));
  const startlistIds = startlist.map(s => s.riderId);

  // Find followers (race_event followers + rider followers on startlist)
  const followFilter = startlistIds.length > 0
    ? and(
        eq(userFollows.followType, "race_event"),
        eq(userFollows.entityId, race.raceEventId)
      )
    : and(
        eq(userFollows.followType, "race_event"),
        eq(userFollows.entityId, race.raceEventId)
      );

  let followRows = await db
    .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, "race_event"), eq(userFollows.entityId, race.raceEventId)));

  if (startlistIds.length > 0) {
    const riderFollows = await db
      .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
      .from(userFollows)
      .where(and(eq(userFollows.followType, "rider"), inArray(userFollows.entityId, startlistIds)));
    followRows = [...followRows, ...riderFollows];
  }

  if (followRows.length === 0) return { sent: 0, skipped: 0, dupes: 0 };

  // Group by user
  const userMap = new Map<string, { riderIds: string[]; followsEvent: boolean }>();
  for (const row of followRows) {
    if (!userMap.has(row.userId)) userMap.set(row.userId, { riderIds: [], followsEvent: false });
    const e = userMap.get(row.userId)!;
    if (row.followType === "rider") e.riderIds.push(row.entityId);
    else e.followsEvent = true;
  }

  // Top 5 predictions
  const topPreds = await db
    .select({
      position: predictions.predictedPosition,
      winProb: predictions.winProbability,
      riderName: riders.name,
    })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, race.raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(5);

  const raceUrl = race.eventSlug
    ? `https://procyclingpredictor.com/races/${race.discipline}/${race.eventSlug}${race.categorySlug ? `/${race.categorySlug}` : ""}`
    : "https://procyclingpredictor.com";

  // Get contacts for all users in this race
  const userIds = Array.from(userMap.keys());
  const [tgRows, waRows] = await Promise.all([
    db.select({ userId: userTelegram.userId, chatId: userTelegram.telegramChatId })
      .from(userTelegram)
      .where(inArray(userTelegram.userId, userIds)),
    db.select({ userId: userWhatsapp.userId, phone: userWhatsapp.phoneNumber })
      .from(userWhatsapp)
      .where(inArray(userWhatsapp.userId, userIds)),
  ]);

  const tgByUser = new Map(tgRows.filter(r => r.chatId).map(r => [r.userId, r.chatId!]));
  const waByUser = new Map(waRows.filter(r => r.phone).map(r => [r.userId, r.phone!]));

  // Build send tasks (max 20 concurrent)
  type SendTask = () => Promise<void>;
  const tasks: SendTask[] = [];

  for (const [userId, data] of userMap) {
    const hasTg = tgByUser.has(userId);
    const hasWa = waByUser.has(userId);
    if (!hasTg && !hasWa) { skipped++; continue; }

    // Get followed rider predictions for this user
    let followedRiders: Array<{ name: string; predictedPosition: number | null }> = [];
    if (data.riderIds.length > 0) {
      const riderPreds = await db
        .select({ name: riders.name, pos: predictions.predictedPosition })
        .from(riders)
        .leftJoin(predictions, and(eq(predictions.raceId, race.raceId), eq(predictions.riderId, riders.id)))
        .where(inArray(riders.id, data.riderIds));
      followedRiders = riderPreds.map(r => ({ name: r.name, predictedPosition: r.pos }));
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
      tasks.push(async () => {
        const chatId = tgByUser.get(userId)!;
        if (await alreadySent(userId, race.raceId, race.messageType, "telegram")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const ok = await sendTelegram(chatId, msg.html);
        if (ok) { await logSent(userId, race.raceId, race.messageType, "telegram"); sent++; }
        else { skipped++; }
      });
    }

    // WhatsApp send task
    if (hasWa) {
      tasks.push(async () => {
        const phone = waByUser.get(userId)!;
        if (await alreadySent(userId, race.raceId, race.messageType, "whatsapp")) { dupes++; return; }
        const msg = await generateMessage(prompt);
        if (!msg) { skipped++; return; }
        const ok = await sendWhatsApp(phone, msg.plain);
        if (ok) { await logSent(userId, race.raceId, race.messageType, "whatsapp"); sent++; }
        else { skipped++; }
      });
    }
  }

  // Execute in batches of 20
  for (let i = 0; i < tasks.length; i += 20) {
    const batch = tasks.slice(i, i + 20);
    await Promise.allSettled(batch.map(fn => fn()));
  }

  return { sent, skipped, dupes };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

export async function POST() {
  return GET();
}
