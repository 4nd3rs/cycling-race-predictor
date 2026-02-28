/**
 * notify-followers.ts
 * Sends Telegram DMs to users who follow a rider or race_event.
 */

import { db, userFollows, userTelegram, userWhatsapp, riders, raceEvents, races } from "./db";
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
async function notifyContacts(followType: "rider" | "race_event" | "race", entityId: string, tgMessage: string, waMessage?: string): Promise<number> {
  const contacts = await getContactsForFollowers(followType, entityId);
  for (const chatId of contacts.telegram) await sendTg(chatId, tgMessage);
  const waText = waMessage ?? tgMessage.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  for (const phone of contacts.whatsapp) await sendWhatsApp(phone, waText);
  return contacts.telegram.length + contacts.whatsapp.length;
}

/** Notify all followers of a specific race (category-level follow) */
export async function notifyRaceFollowers(raceId: string, message: string, waMessage?: string): Promise<number> {
  return notifyContacts("race", raceId, message, waMessage);
}

/** Notify all followers of a race_event */
export async function notifyRaceEventFollowers(raceEventId: string, message: string, waMessage?: string): Promise<number> {
  return notifyContacts("race_event", raceEventId, message, waMessage);
}

/** Notify all followers of a rider */
export async function notifyRiderFollowers(riderId: string, message: string, waMessage?: string): Promise<number> {
  return notifyContacts("rider", riderId, message, waMessage);
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
