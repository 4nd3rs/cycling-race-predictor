/**
 * notify-followers.ts
 * Sends Telegram DMs to users who follow a rider or race_event.
 */

import { db, userFollows, userTelegram, riders, raceEvents, races } from "./db";
import { eq, and, inArray } from "drizzle-orm";

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

/** Notify all followers of a race_event */
export async function notifyRaceEventFollowers(
  raceEventId: string,
  message: string
): Promise<number> {
  const chatIds = await getChatIdsForFollowers("race_event", raceEventId);
  for (const chatId of chatIds) {
    await sendTg(chatId, message);
  }
  return chatIds.length;
}

/** Notify all followers of a rider */
export async function notifyRiderFollowers(
  riderId: string,
  message: string
): Promise<number> {
  const chatIds = await getChatIdsForFollowers("rider", riderId);
  for (const chatId of chatIds) {
    await sendTg(chatId, message);
  }
  return chatIds.length;
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
