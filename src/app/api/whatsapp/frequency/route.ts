import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db, userWhatsapp } from "@/lib/db";
import { eq } from "drizzle-orm";

const VALID_FREQUENCIES = ["all", "key-moments", "race-day-only", "off"];

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { frequency } = await req.json();
  if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
    return NextResponse.json({ error: "Invalid frequency. Must be one of: " + VALID_FREQUENCIES.join(", ") }, { status: 400 });
  }

  const existing = await db.select({ id: userWhatsapp.id })
    .from(userWhatsapp)
    .where(eq(userWhatsapp.userId, user.id))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: "No WhatsApp registration found" }, { status: 404 });
  }

  await db.update(userWhatsapp)
    .set({ notificationFrequency: frequency })
    .where(eq(userWhatsapp.userId, user.id));

  return NextResponse.json({ ok: true, frequency });
}
