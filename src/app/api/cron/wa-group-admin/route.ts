/**
 * POST/GET /api/cron/wa-group-admin
 * Checks WA group members against registered users.
 * Unregistered members get a DM warning with registration link.
 * Runs daily.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, waGroupMembers, userWhatsapp } from "@/lib/db";
import { eq, isNull } from "drizzle-orm";

export const maxDuration = 30;

const APP_URL = "https://procyclingpredictor.com";
const ADMIN_PHONE = "46707961967@s.whatsapp.net"; // Anders — receives admin report

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── WA Gateway ────────────────────────────────────────────────────────────────

async function sendDm(jid: string, text: string): Promise<boolean> {
  const gateway = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!gateway || !token) {
    console.warn("WA gateway not configured");
    return false;
  }

  // Convert JID to phone format for the gateway
  const phone = "+" + jid.replace("@s.whatsapp.net", "");

  const res = await fetch(`${gateway}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: phone, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`WA DM send failed to ${phone}: ${res.status} ${body}`);
    return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysDiff(from: Date, to: Date = new Date()): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

function jidToPhone(jid: string): string {
  return "+" + jid.replace("@s.whatsapp.net", "");
}

// ── Main logic ────────────────────────────────────────────────────────────────

async function runAdminCheck() {
  const members = await db.select().from(waGroupMembers).where(isNull(waGroupMembers.kickedAt));
  const registered = await db.select({ phone: userWhatsapp.phoneNumber }).from(userWhatsapp);
  const registeredPhones = new Set(registered.map(r => r.phone?.replace(/^\+/, "") ?? ""));

  const unregistered: string[] = [];
  let warned = 0;

  for (const member of members) {
    if (member.isAdmin) continue;

    const memberPhone = member.phoneNumber?.replace(/^\+/, "") ?? member.jid.replace("@s.whatsapp.net", "");
    if (registeredPhones.has(memberPhone)) continue;

    const label = member.displayName
      ? `${member.displayName} (${member.phoneNumber ?? member.jid})`
      : (member.phoneNumber ?? member.jid);
    unregistered.push(label);

    // Send DM reminder (once per day max)
    if (!member.lastWarnedAt || daysDiff(new Date(member.lastWarnedAt)) >= 1) {
      const msg = `👋 Hey! You're in the *Pro Cycling Predictor Road* WhatsApp group.

To stay in the group, please register at:
👉 ${APP_URL}/profile → add your WhatsApp number

Takes 30 seconds. If you need help, just reply here. 🚴`;

      const sent = await sendDm(member.jid, msg);
      if (sent) {
        warned++;
        await db.update(waGroupMembers)
          .set({
            warningCount: member.warningCount + 1,
            firstWarnedAt: member.firstWarnedAt ?? new Date(),
            lastWarnedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(waGroupMembers.id, member.id));
      }
    }
  }

  // Send admin report if there are unregistered members
  if (unregistered.length > 0) {
    const report = `🛡️ *PCP Road Group — Unregistered Members*\n\n${unregistered.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\nWarnings sent this run: ${warned}`;
    await sendDm(ADMIN_PHONE, report);
  }

  return {
    totalMembers: members.length,
    unregistered: unregistered.length,
    warned,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAdminCheck();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[cron/wa-group-admin]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
