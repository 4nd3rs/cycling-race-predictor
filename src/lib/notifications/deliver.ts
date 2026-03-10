import { db, userBriefingLog, notificationLog } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import type { GeneratedMessage } from "./generate";
import type { BriefingType } from "./types";

// ── Sending ─────────────────────────────────────────────────────────────────

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
          eq(userBriefingLog.channel, "whatsapp"),
        )
      )
      .limit(1);
    return row.length > 0;
  } catch {
    const dedupKey = `briefing-${briefingType}-${briefingDate}`;
    const row = await db.query.notificationLog.findFirst({
      where: and(
        eq(notificationLog.userId, userId),
        eq(notificationLog.entityId, dedupKey),
        eq(notificationLog.eventType, "briefing"),
        eq(notificationLog.channel, "whatsapp"),
      ),
    });
    return !!row;
  }
}

async function logBriefingSent(
  userId: string,
  briefingDate: string,
  briefingType: BriefingType,
  contentKey?: string,
) {
  await db.insert(userBriefingLog).values({
    userId,
    briefingDate,
    briefingType,
    channel: "whatsapp",
    contentKey: contentKey || null,
  }).onConflictDoNothing().catch(() => {});

  const dedupKey = `briefing-${briefingType}-${briefingDate}`;
  await db.insert(notificationLog).values({
    userId,
    channel: "whatsapp",
    eventType: "briefing",
    entityId: dedupKey,
  }).onConflictDoNothing();
}

// ── Deliver to one user ─────────────────────────────────────────────────────

export interface DeliveryResult {
  userId: string;
  sent: boolean;
  skippedDedup: boolean;
}

export async function deliverBriefing(
  userId: string,
  briefingType: BriefingType,
  message: GeneratedMessage,
  whatsappPhone: string,
): Promise<DeliveryResult> {
  const briefingDate = new Date().toISOString().slice(0, 10);

  if (await alreadySentBriefing(userId, briefingDate, briefingType)) {
    return { userId, sent: false, skippedDedup: true };
  }

  const sent = await sendWhatsApp(whatsappPhone, message.plain);
  if (sent) {
    await logBriefingSent(userId, briefingDate, briefingType);
  }

  return { userId, sent, skippedDedup: false };
}

// ── Batch delivery ──────────────────────────────────────────────────────────

export interface BatchDeliveryPlan {
  userId: string;
  briefingType: BriefingType;
  message: GeneratedMessage;
  whatsappPhone: string | null;
}

export async function deliverBatch(
  plans: BatchDeliveryPlan[],
  timeBudgetMs: number = 50_000,
): Promise<{ sent: number; skipped: number; dupes: number }> {
  let sent = 0, skipped = 0, dupes = 0;
  const startTime = Date.now();

  for (const plan of plans) {
    if (!plan.whatsappPhone) { skipped++; continue; }
    if (Date.now() - startTime > timeBudgetMs) { skipped++; break; }

    const result = await deliverBriefing(
      plan.userId, plan.briefingType, plan.message, plan.whatsappPhone
    );
    if (result.sent) sent++;
    else if (result.skippedDedup) dupes++;
    else skipped++;

    await sleep(1500);
  }

  return { sent, skipped, dupes };
}
