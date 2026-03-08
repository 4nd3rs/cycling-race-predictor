/**
 * notify-followers.ts
 * Sends Telegram DMs to users who follow a rider or race_event.
 */

import { db, userFollows, userTelegram, notificationLog, riders, raceEvents, races } from "./db";
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

async function getTelegramContactsForFollowers(
  followType: "rider" | "race_event" | "race",
  entityId: string
): Promise<string[]> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return [];
  const userIds = follows.map((f) => f.userId);

  const tgRows = await db.select({ telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt)));

  return tgRows.map((r) => r.telegramChatId).filter((id): id is string => !!id);
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

/** Send Telegram notifications to all followers of an entity */
async function notifyContacts(followType: "rider" | "race_event" | "race", entityId: string, tgMessage: string, _waMessage?: string, eventType = "general"): Promise<number> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return 0;
  const userIds = follows.map((f) => f.userId);
  const tgRows = await db.select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram).where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt)));

  let sent = 0;

  for (const row of tgRows) {
    if (!row.telegramChatId) continue;
    if (await hasNotified(row.userId, "telegram", eventType, entityId)) continue;
    await sendTg(row.telegramChatId, tgMessage);
    await logNotification(row.userId, "telegram", eventType, entityId);
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
  _headerWa: string,
  footerTg: string,
  _footerWa: string,
  eventType = "race_event"
): Promise<number> {
  if (races.length === 0) return 0;

  const raceIds = races.map((r) => r.raceId);

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
  const tgRows = await db.select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram).where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt)));

  const tgByUser = new Map(tgRows.map((r) => [r.userId, r.telegramChatId]));

  let sent = 0;

  for (const [userId, followedRaceIds] of userMap) {
    if (await hasNotified(userId, "telegram", eventType, raceEventId)) continue;

    const userRaces = races.filter((r) => followedRaceIds.has(r.raceId));
    if (userRaces.length === 0) continue;

    const chatId = tgByUser.get(userId);
    if (chatId) {
      const tgBody = userRaces.length > 1
        ? userRaces.map((r) => `<b>${r.categoryLabel}</b>\n${r.tgSection}`).join("\n\n")
        : userRaces[0].tgSection;
      const tgMsg = [headerTg, "", tgBody, "", footerTg].filter(Boolean).join("\n");
      await sendTg(chatId, tgMsg);
      await logNotification(userId, "telegram", eventType, raceEventId);
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
