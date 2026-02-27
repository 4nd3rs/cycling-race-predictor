import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth";
import { db, userWhatsapp } from "@/lib/db";
import { eq } from "drizzle-orm";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const user = await requireAuth();
  const { phone } = await req.json();

  if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone.replace(/\s/g, ""))) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const normalized = phone.replace(/\s/g, "").startsWith("+")
    ? phone.replace(/\s/g, "")
    : `+${phone.replace(/\s/g, "")}`;

  const token = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8-char code

  const [existing] = await db
    .select()
    .from(userWhatsapp)
    .where(eq(userWhatsapp.userId, user.id))
    .limit(1);

  if (existing) {
    await db.update(userWhatsapp).set({ phoneNumber: normalized, connectToken: token }).where(eq(userWhatsapp.userId, user.id));
  } else {
    await db.insert(userWhatsapp).values({ userId: user.id, phoneNumber: normalized, connectToken: token });
  }

  const sent = await sendWhatsAppMessage(
    normalized,
    `Your Pro Cycling Predictor verification code: *${token}*\n\nReply with this code on procyclingpredictor.com/profile to activate race alerts.`
  );

  if (!sent) {
    return NextResponse.json({ error: "Failed to send WhatsApp message" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const user = await requireAuth();
  const { code } = await req.json();

  const [row] = await db
    .select()
    .from(userWhatsapp)
    .where(eq(userWhatsapp.userId, user.id))
    .limit(1);

  if (!row || row.connectToken !== code.toUpperCase()) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await db.update(userWhatsapp)
    .set({ connectedAt: new Date(), connectToken: null })
    .where(eq(userWhatsapp.userId, user.id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth();
  await db.delete(userWhatsapp).where(eq(userWhatsapp.userId, user.id));
  return NextResponse.json({ ok: true });
}
