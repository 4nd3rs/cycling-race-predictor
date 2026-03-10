import { db, userBriefingLog, notificationLog } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import type { GeneratedMessage } from "./generate";
import type { BriefingType } from "./types";

// ── Sending helpers ─────────────────────────────────────────────────────────

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Dedup check ─────────────────────────────────────────────────────────────

async function alreadySentBriefing(
  userId: string,
  briefingDate: string,
  briefingType: BriefingType,
  channel: string,
): Promise<boolean> {
  try {
    const row = await db
      .select({ id: userBriefingLog.id })
      .from(userBriefingLog)
      .where(
        and(
          eq(userBriefingLog.userId, userId),
          eq(userBriefingLog.briefingDate, briefingDate),
          eq(userBriefingLog.briefingType, briefingType),
          eq(userBriefingLog.channel, channel),
        )
      )
      .limit(1);
    return row.length > 0;
  } catch {
    // Fallback to notificationLog if briefing table doesn't exist yet
    const dedupKey = `briefing-${briefingType}-${briefingDate}`;
    const row = await db.query.notificationLog.findFirst({
      where: and(
        eq(notificationLog.userId, userId),
        eq(notificationLog.entityId, dedupKey),
        eq(notificationLog.eventType, "briefing"),
        eq(notificationLog.channel, channel),
      ),
    });
    return !!row;
  }
}

async function logBriefingSent(
  userId: string,
  briefingDate: string,
  briefingType: BriefingType,
  channel: string,
  contentKey?: string,
) {
  // Log in briefing table
  await db.insert(userBriefingLog).values({
    userId,
    briefingDate,
    briefingType,
    channel,
    contentKey: contentKey || null,
  }).onConflictDoNothing().catch(() => {});

  // Also log in notificationLog for backward compat
  const dedupKey = `briefing-${briefingType}-${briefingDate}`;
  await db.insert(notificationLog).values({
    userId,
    channel,
    eventType: "briefing",
    entityId: dedupKey,
  }).onConflictDoNothing();
}

// ── Deliver to one user ─────────────────────────────────────────────────────

export interface DeliveryResult {
  userId: string;
  telegramSent: boolean;
  whatsappSent: boolean;
  skippedDedup: boolean;
}

export async function deliverBriefing(
  userId: string,
  briefingType: BriefingType,
  message: GeneratedMessage,
  telegramChatId: string | null,
  whatsappPhone: string | null,
): Promise<DeliveryResult> {
  const briefingDate = new Date().toISOString().slice(0, 10);
  let telegramSent = false;
  let whatsappSent = false;
  let skippedDedup = false;

  // Telegram
  if (telegramChatId) {
    if (await alreadySentBriefing(userId, briefingDate, briefingType, "telegram")) {
      skippedDedup = true;
    } else {
      telegramSent = await sendTelegram(telegramChatId, message.html);
      if (telegramSent) {
        await logBriefingSent(userId, briefingDate, briefingType, "telegram");
      }
    }
  }

  // WhatsApp
  if (whatsappPhone) {
    if (await alreadySentBriefing(userId, briefingDate, briefingType, "whatsapp")) {
      skippedDedup = true;
    } else {
      whatsappSent = await sendWhatsApp(whatsappPhone, message.plain);
      if (whatsappSent) {
        await logBriefingSent(userId, briefingDate, briefingType, "whatsapp");
      }
    }
  }

  return { userId, telegramSent, whatsappSent, skippedDedup };
}

// ── Batch delivery ──────────────────────────────────────────────────────────

export interface BatchDeliveryPlan {
  userId: string;
  briefingType: BriefingType;
  message: GeneratedMessage;
  telegramChatId: string | null;
  whatsappPhone: string | null;
}

export async function deliverBatch(
  plans: BatchDeliveryPlan[],
  timeBudgetMs: number = 50_000,
): Promise<{ sent: number; skipped: number; dupes: number }> {
  let sent = 0, skipped = 0, dupes = 0;
  const startTime = Date.now();

  // Separate Telegram and WhatsApp tasks
  const tgTasks: Array<() => Promise<void>> = [];
  const waTasks: Array<() => Promise<void>> = [];

  for (const plan of plans) {
    if (plan.telegramChatId) {
      tgTasks.push(async () => {
        const result = await deliverBriefing(
          plan.userId, plan.briefingType, plan.message,
          plan.telegramChatId, null
        );
        if (result.telegramSent) sent++;
        else if (result.skippedDedup) dupes++;
        else skipped++;
      });
    }
    if (plan.whatsappPhone) {
      waTasks.push(async () => {
        const result = await deliverBriefing(
          plan.userId, plan.briefingType, plan.message,
          null, plan.whatsappPhone
        );
        if (result.whatsappSent) sent++;
        else if (result.skippedDedup) dupes++;
        else skipped++;
      });
    }
  }

  // Telegram: parallel batches of 20
  for (let i = 0; i < tgTasks.length; i += 20) {
    if (Date.now() - startTime > timeBudgetMs) break;
    const batch = tgTasks.slice(i, i + 20);
    await Promise.allSettled(batch.map(fn => fn()));
  }

  // WhatsApp: sequential with 1.5s delay
  for (const task of waTasks) {
    if (Date.now() - startTime > timeBudgetMs) { skipped += 1; break; }
    await task();
    await sleep(1500);
  }

  return { sent, skipped, dupes };
}
