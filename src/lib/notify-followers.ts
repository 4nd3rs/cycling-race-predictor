/**
 * notify-followers.ts
 * Sends Telegram DMs to users who follow a rider or race_event.
 */

import { db, userFollows, userTelegram, notificationLog, raceEvents, races } from "@/lib/db";
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

// ── Simple notifiers ──────────────────────────────────────────────────────────

async function notifyContacts(followType: "rider" | "race_event" | "race", entityId: string, tgMessage: string, eventType = "general"): Promise<number> {
  const follows = await db
    .select({ userId: userFollows.userId })
    .from(userFollows)
    .where(and(eq(userFollows.followType, followType), eq(userFollows.entityId, entityId)));

  if (follows.length === 0) return 0;
  const userIds = follows.map((f) => f.userId);

  const tgRows = await db
    .select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt)));

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

export async function notifyRaceFollowers(raceId: string, message: string, eventType = "race"): Promise<number> {
  return notifyContacts("race", raceId, message, eventType);
}

export async function notifyRaceEventFollowers(raceEventId: string, message: string, eventType = "race_event"): Promise<number> {
  return notifyContacts("race_event", raceEventId, message, eventType);
}

export async function notifyRiderFollowers(riderId: string, message: string, eventType = "rider"): Promise<number> {
  return notifyContacts("rider", riderId, message, eventType);
}

// ── Combined (multi-category) ─────────────────────────────────────────────────

export interface RaceSection {
  raceId: string;
  categoryLabel: string;
  tgSection: string;
  waSection: string; // kept for API compatibility — unused
}

export async function notifyRaceEventCombined(
  raceEventId: string,
  raceSections: RaceSection[],
  headerTg: string,
  headerWa: string,   // unused — kept for API compatibility
  footerTg: string,
  footerWa: string,   // unused — kept for API compatibility
  eventType = "race_event"
): Promise<number> {
  if (raceSections.length === 0) return 0;

  const raceIds = raceSections.map((r) => r.raceId);

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
  const tgRows = await db
    .select({ userId: userTelegram.userId, telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(and(inArray(userTelegram.userId, userIds), eq(userTelegram.connectedAt, userTelegram.connectedAt)));

  const tgByUser = new Map(tgRows.map((r) => [r.userId, r.telegramChatId]));
  let sent = 0;

  for (const [userId, followedRaceIds] of userMap) {
    const userRaces = raceSections.filter((r) => followedRaceIds.has(r.raceId));
    if (userRaces.length === 0) continue;

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
  }

  return sent;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

export async function getRaceEventId(raceId: string): Promise<string | null> {
  const [row] = await db
    .select({ raceEventId: races.raceEventId })
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  return row?.raceEventId ?? null;
}

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
