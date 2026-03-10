import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  db,
  userFollows,
  userTelegram,
  userWhatsapp,
} from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getTimeWindow } from "@/lib/notifications/types";
import type { TimeWindow, UserChannels } from "@/lib/notifications/types";
import { gatherContext } from "@/lib/notifications/gather";
import { decide } from "@/lib/notifications/decide";
import { generateBriefing } from "@/lib/notifications/generate";
import { deliverBatch } from "@/lib/notifications/deliver";
import type { BatchDeliveryPlan } from "@/lib/notifications/deliver";

export const maxDuration = 60;

// ── Load all users with their channels and follows ──────────────────────────

async function loadUsers(): Promise<UserChannels[]> {
  // Get all users who have at least one channel
  const [tgRows, waRows] = await Promise.all([
    db.select({ userId: userTelegram.userId, chatId: userTelegram.telegramChatId })
      .from(userTelegram),
    db.select({
      userId: userWhatsapp.userId,
      phone: userWhatsapp.phoneNumber,
      frequency: userWhatsapp.notificationFrequency,
    }).from(userWhatsapp),
  ]);

  // Merge into a map of userId → channels
  const userMap = new Map<string, {
    telegramChatId: string | null;
    whatsappPhone: string | null;
    whatsappFrequency: string | null;
  }>();

  for (const tg of tgRows) {
    if (!tg.chatId) continue;
    userMap.set(tg.userId, {
      telegramChatId: tg.chatId,
      whatsappPhone: null,
      whatsappFrequency: null,
    });
  }

  for (const wa of waRows) {
    if (!wa.phone || wa.frequency === "off") continue;
    const existing = userMap.get(wa.userId);
    if (existing) {
      existing.whatsappPhone = wa.phone;
      existing.whatsappFrequency = wa.frequency;
    } else {
      userMap.set(wa.userId, {
        telegramChatId: null,
        whatsappPhone: wa.phone,
        whatsappFrequency: wa.frequency,
      });
    }
  }

  if (userMap.size === 0) return [];

  // Load follows for all users
  const userIds = [...userMap.keys()];
  const followRows = await db
    .select({
      userId: userFollows.userId,
      followType: userFollows.followType,
      entityId: userFollows.entityId,
    })
    .from(userFollows)
    .where(inArray(userFollows.userId, userIds));

  // Group follows by user
  const followsByUser = new Map<string, { riders: Set<string>; teams: Set<string>; events: Set<string> }>();
  for (const f of followRows) {
    if (!followsByUser.has(f.userId)) {
      followsByUser.set(f.userId, { riders: new Set(), teams: new Set(), events: new Set() });
    }
    const uf = followsByUser.get(f.userId)!;
    if (f.followType === "rider") uf.riders.add(f.entityId);
    else if (f.followType === "team") uf.teams.add(f.entityId);
    else if (f.followType === "race_event") uf.events.add(f.entityId);
  }

  return userIds.map(userId => {
    const channels = userMap.get(userId)!;
    const follows = followsByUser.get(userId) || { riders: new Set(), teams: new Set(), events: new Set() };
    return {
      userId,
      ...channels,
      followedRiderIds: follows.riders,
      followedTeamIds: follows.teams,
      followedRaceEventIds: follows.events,
    };
  }).filter(u =>
    // Only include users who actually follow something
    u.followedRiderIds.size > 0 || u.followedTeamIds.size > 0 || u.followedRaceEventIds.size > 0
  );
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const testWindow = url.searchParams.get("window") as TimeWindow | null;
  const testMode = url.searchParams.get("test") === "true";

  // Determine time window
  const utcHour = new Date().getUTCHours();
  const window = testWindow || getTimeWindow(utcHour);

  if (!window) {
    return NextResponse.json({ success: true, message: "Outside active hours", utcHour });
  }

  try {
    const startTime = Date.now();

    // Phase 1: Gather (shared)
    const ctx = await gatherContext();
    const gatherMs = Date.now() - startTime;

    // Load all eligible users
    const users = await loadUsers();
    if (users.length === 0) {
      return NextResponse.json({ success: true, message: "No eligible users", window, gatherMs });
    }

    // Phase 2 + 3: Decide and Generate per user
    const deliveryPlans: BatchDeliveryPlan[] = [];
    let decidedCount = 0;
    let skippedNoContent = 0;
    let generateErrors = 0;

    for (const user of users) {
      // Budget check: leave 10s for delivery
      if (Date.now() - startTime > 45_000 && !testMode) break;

      const plan = decide(ctx, user, window);
      if (!plan) { skippedNoContent++; continue; }
      decidedCount++;

      const message = await generateBriefing(plan, ctx);
      if (!message) { generateErrors++; continue; }

      deliveryPlans.push({
        userId: user.userId,
        briefingType: plan.briefingType,
        message,
        telegramChatId: plan.telegramChatId,
        whatsappPhone: plan.whatsappPhone,
      });
    }

    // Phase 4: Deliver
    const deliveryResult = testMode
      ? { sent: 0, skipped: deliveryPlans.length, dupes: 0 }
      : await deliverBatch(deliveryPlans);

    const totalMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      window,
      utcHour,
      timing: { gatherMs, totalMs },
      users: users.length,
      decided: decidedCount,
      skippedNoContent,
      generateErrors,
      delivery: deliveryResult,
      // In test mode, include preview of what would be sent
      ...(testMode && {
        preview: deliveryPlans.map(p => ({
          userId: p.userId,
          briefingType: p.briefingType,
          message: p.message.plain.slice(0, 500),
        })),
      }),
    });
  } catch (error) {
    console.error("[cron/daily-briefing]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
