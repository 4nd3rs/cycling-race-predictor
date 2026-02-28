/**
 * notify-followers.ts
 * Sends Telegram DMs to users who follow a rider or race_event.
 */

import { db, userFollows, userTelegram, userWhatsapp, notificationLog, riders, raceEvents, races } from "./db";
import { eq, and, inArray, or } from "drizzle-orm";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTg(chatId: string, html: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Telegram DM failed (chatId=${chatId}): ${res.status} ${body}`);
  }
}

/** Get all connected Telegram chat IDs for users following a given entity */
async function sendWhatsApp(phone: string, text: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sid || !token || !from) return;
  const to = phone.startsWith("+") ? phone : `+${phone}`;
  const body = new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) console.error(`WhatsApp send failed (${to}): ${res.status}`);
}

// ── Dedup log ────────────────────────────────────────────────────────────────
async function hasNotified(userId: string, channel: string, eventType: string, entityId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h window
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(
      eq(notificationLog.userId, userId),
      eq(notificationLog.channel, channel),
      eq(notificationLog.eventType, eventType),
      eq(notificationLog.entityId, entityId),
    ))
    .limit(1);
  return !!row;
}

async function logNotification(userId: string, channel: string, eventType: string, entityId: string) {
  await db.insert(notificationLog).values({ userId, channel, eventType, entityId }).catch(() => {});
}

async function getContactsForFollowers(
  followType: "rider" | "race_event" | "race",
  entityId: string
): Promise<{ telegram: string[]; whatsapp: string[] }> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return { telegram: [], whatsapp: [] };
  const userIds = follows.map((f) => f.userId);

  const [tgRows, waRows] = await Promise.all([
    db.select({ telegramChatId: userTelegram.telegramChatId })
      .from(userTelegram)
      .where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt))),
    db.select({ phoneNumber: userWhatsapp.phoneNumber })
      .from(userWhatsapp)
      .where(and(inArray(userWhatsapp.userId, userIds), eq(userWhatsapp.connectedAt, userWhatsapp.connectedAt))),
  ]);

  return {
    telegram: tgRows.map((r) => r.telegramChatId).filter((id): id is string => !!id),
    whatsapp: waRows.map((r) => r.phoneNumber).filter((p): p is string => !!p),
  };
}

async function getChatIdsForFollowers(
  followType: "rider" | "race_event",
  entityId: string
): Promise<string[]> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return [];

  const userIds = follows.map((f) => f.userId);
  const tgRows = await db
    .select({ telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(
      and(
        inArray(userTelegram.userId, userIds),
        // Only users who have completed the connect flow
        eq(userTelegram.connectedAt, userTelegram.connectedAt) // connectedAt IS NOT NULL
      )
    );

  return tgRows
    .map((r) => r.telegramChatId)
    .filter((id): id is string => !!id);
}

/** Send to all channels for a set of user IDs */
async function notifyContacts(followType: "rider" | "race_event" | "race", entityId: string, tgMessage: string, waMessage?: string, eventType = "general"): Promise<number> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return 0;
  const userIds = follows.map((f) => f.userId);
  const [tgRows, waRows] = await Promise.all([
    db.select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
      .from(userTelegram).where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt))),
    db.select({ userId: userWhatsapp.userId, phoneNumber: userWhatsapp.phoneNumber })
      .from(userWhatsapp).where(and(inArray(userWhatsapp.userId, userIds), eq(userWhatsapp.connectedAt, userWhatsapp.connectedAt))),
  ]);

  const waText = waMessage ?? tgMessage.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  let sent = 0;

  for (const row of tgRows) {
    if (!row.telegramChatId) continue;
    if (await hasNotified(row.userId, "telegram", eventType, entityId)) continue;
    await sendTg(row.telegramChatId, tgMessage);
    await logNotification(row.userId, "telegram", eventType, entityId);
    sent++;
  }
  for (const row of waRows) {
    if (!row.phoneNumber) continue;
    if (await hasNotified(row.userId, "whatsapp", eventType, entityId)) continue;
    await sendWhatsApp(row.phoneNumber, waText);
    await logNotification(row.userId, "whatsapp", eventType, entityId);
    sent++;
  }
  return sent;
}

/** Notify all followers of a specific race (category-level follow) */
export async function notifyRaceFollowers(raceId: string, message: string, waMessage?: string, eventType = "race"): Promise<number> {
  return notifyContacts("race", raceId, message, waMessage, eventType);
}

/** Notify all followers of a race_event */
export async function notifyRaceEventFollowers(raceEventId: string, message: string, waMessage?: string, eventType = "race_event"): Promise<number> {
  return notifyContacts("race_event", raceEventId, message, waMessage, eventType);
}

/** Notify all followers of a rider */
export async function notifyRiderFollowers(riderId: string, message: string, waMessage?: string, eventType = "rider"): Promise<number> {
  return notifyContacts("rider", riderId, message, waMessage, eventType);
}

/**
 * Combined notification for multiple races under the same event.
 * Users following the race_event OR multiple individual races get ONE message.
 * Users following only one category get a single-category message.
 *
 * races: array of { raceId, categoryLabel, tgSection, waSection }
 * headerTg / headerWa: shared header (event name, date, link)
 */
export interface RaceSection {
  raceId: string;
  categoryLabel: string; // e.g. "Elite Men", "Elite Women"
  tgSection: string;     // HTML body for this category
  waSection: string;     // Plain text body for this category
}

export async function notifyRaceEventCombined(
  raceEventId: string,
  races: RaceSection[],
  headerTg: string,
  headerWa: string,
  footerTg: string,
  footerWa: string,
  eventType = "race_event"
): Promise<number> {
  if (races.length === 0) return 0;

  // Collect all user→channels, noting which races they follow
  const raceIds = races.map((r) => r.raceId);

  // All follows: race_event + individual races
  const allFollows = await db
    .select({ userId: userFollows.userId, followType: userFollows.followType, entityId: userFollows.entityId })
    .from(userFollows)
    .where(
      or(
        and(eq(userFollows.followType, "race_event"), eq(userFollows.entityId, raceEventId)),
        and(eq(userFollows.followType, "race"), inArray(userFollows.entityId, raceIds))
      )
    );

  if (allFollows.length === 0) return 0;

  // Group by userId → which raceIds they follow (race_event = all)
  const userMap = new Map<string, Set<string>>();
  for (const f of allFollows) {
    if (!userMap.has(f.userId)) userMap.set(f.userId, new Set());
    if (f.followType === "race_event") {
      raceIds.forEach((id) => userMap.get(f.userId)!.add(id));
    } else {
      userMap.get(f.userId)!.add(f.entityId);
    }
  }

  const userIds = Array.from(userMap.keys());
  const [tgRows, waRows] = await Promise.all([
    db.select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
      .from(userTelegram).where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt))),
    db.select({ userId: userWhatsapp.userId, phoneNumber: userWhatsapp.phoneNumber })
      .from(userWhatsapp).where(and(inArray(userWhatsapp.userId, userIds), eq(userWhatsapp.connectedAt, userWhatsapp.connectedAt))),
  ]);

  const tgByUser = new Map(tgRows.map((r) => [r.userId, r.telegramChatId]));
  const waByUser = new Map(waRows.map((r) => [r.userId, r.phoneNumber]));

  let sent = 0;

  for (const [userId, followedRaceIds] of userMap) {
    if (await hasNotified(userId, "telegram", eventType, raceEventId) &&
        await hasNotified(userId, "whatsapp", eventType, raceEventId)) continue;

    // Build sections relevant to this user
    const userRaces = races.filter((r) => followedRaceIds.has(r.raceId));
    if (userRaces.length === 0) continue;

    // Telegram
    const chatId = tgByUser.get(userId);
    if (chatId && !(await hasNotified(userId, "telegram", eventType, raceEventId))) {
      const tgBody = userRaces.length > 1
        ? userRaces.map((r) => `<b>${r.categoryLabel}</b>\n${r.tgSection}`).join("\n\n")
        : userRaces[0].tgSection;
      const tgMsg = [headerTg, "", tgBody, "", footerTg].filter(Boolean).join("\n");
      await sendTg(chatId, tgMsg);
      await logNotification(userId, "telegram", eventType, raceEventId);
      sent++;
    }

    // WhatsApp
    const phone = waByUser.get(userId);
    if (phone && !(await hasNotified(userId, "whatsapp", eventType, raceEventId))) {
      const waBody = userRaces.length > 1
        ? userRaces.map((r) => `*${r.categoryLabel}*\n${r.waSection}`).join("\n\n")
        : userRaces[0].waSection;
      const waMsg = [headerWa, "", waBody, "", footerWa].filter(Boolean).join("\n");
      await sendWhatsApp(phone, waMsg);
      await logNotification(userId, "whatsapp", eventType, raceEventId);
      sent++;
    }
  }

  return sent;
}

/** Resolve raceEventId from a raceId (races → race_events) */
export async function getRaceEventId(raceId: string): Promise<string | null> {
  const [row] = await db
    .select({ raceEventId: races.raceEventId })
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  return row?.raceEventId ?? null;
}

/** Resolve race name + event slug + discipline for building URLs */
export async function getRaceEventInfo(raceEventId: string): Promise<{
  name: string;
  slug: string | null;
  discipline: string;
} | null> {
  const [row] = await db
    .select({ name: raceEvents.name, slug: raceEvents.slug, discipline: raceEvents.discipline })
    .from(raceEvents)
    .where(eq(raceEvents.id, raceEventId))
    .limit(1);
  return row ?? null;
}

/** Resolve rider name */
export async function getRiderName(riderId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: riders.name })
    .from(riders)
    .where(eq(riders.id, riderId))
    .limit(1);
  return row?.name ?? null;
}
