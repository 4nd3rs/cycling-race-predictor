/**
 * POST /api/whatsapp/register
 * Registers a user's WhatsApp phone number, sends them a DM with the group invite link.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db, userWhatsapp, waGroupMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { sendEmail, waInviteEmailHtml } from "@/lib/email";
import { clerkClient } from "@clerk/nextjs/server";

const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;
const WA_GROUP_INVITE = "https://chat.whatsapp.com/Bxsy2jujxzQESWTi4pw6Z6";

function normalizePhone(raw: string): string {
  // Strip everything except digits and leading +
  const digits = raw.replace(/[^\d+]/g, "");
  // Ensure E.164 format
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  // Swedish numbers without country code
  if (digits.startsWith("07")) return "+46" + digits.slice(1);
  return "+" + digits;
}

function phoneToJid(phone: string): string {
  // Strip + for JID format
  return phone.replace(/^\+/, "") + "@s.whatsapp.net";
}

async function sendWaDm(phone: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        tool: "message",
        args: { action: "send", channel: "whatsapp", target: phone, message },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { phone } = await req.json();
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const normalized = normalizePhone(phone.trim());
  if (!/^\+\d{7,15}$/.test(normalized)) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  // Upsert user_whatsapp
  const existing = await db.select().from(userWhatsapp).where(eq(userWhatsapp.userId, user.id)).limit(1);
  if (existing.length > 0) {
    await db.update(userWhatsapp)
      .set({ phoneNumber: normalized, connectedAt: new Date() })
      .where(eq(userWhatsapp.userId, user.id));
  } else {
    await db.insert(userWhatsapp).values({
      userId: user.id,
      phoneNumber: normalized,
      connectedAt: new Date(),
    });
  }

  // Track in wa_group_members
  const jid = phoneToJid(normalized);
  await db.insert(waGroupMembers)
    .values({ jid, phoneNumber: normalized, inviteSentAt: new Date() })
    .onConflictDoUpdate({
      target: waGroupMembers.jid,
      set: { phoneNumber: normalized, inviteSentAt: new Date(), updatedAt: new Date() },
    });

  // Send welcome DM
  const welcomeMsg = `👋 Hi! You've registered on *Pro Cycling Predictor*.

Here's your invite to our Road Cycling group — predictions, results, and race intel for every WorldTour race:

👉 ${WA_GROUP_INVITE}

In the group you'll get:
🔮 Predictions before every WT race
🏆 Podium posts right after the finish
📰 Breaking news & rider intel

See you in there! 🚴
_procyclingpredictor.com_`;

  const dmSent = await sendWaDm(normalized, welcomeMsg);

  // Also send invite via email — catches WhatsApp Message Requests filtering
  let emailSent = false;
  try {
    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(user.clerkId);
    const email = clerkUser.emailAddresses?.[0]?.emailAddress;
    const name = clerkUser.fullName ?? clerkUser.firstName ?? null;
    if (email) {
      emailSent = await sendEmail({
        to: email,
        subject: "Your Pro Cycling Predictor WhatsApp invite 🚴",
        html: waInviteEmailHtml(name),
      });
    }
  } catch (err) {
    console.error("[register] Email send failed:", err);
  }

  return NextResponse.json({ ok: true, phone: normalized, dmSent, emailSent });
}
