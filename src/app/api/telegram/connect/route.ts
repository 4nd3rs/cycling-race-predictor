import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth";
import { db, userTelegram } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST() {
  const user = await requireAuth();
  const token = crypto.randomBytes(16).toString("hex");

  // Check if row exists
  const [existing] = await db
    .select()
    .from(userTelegram)
    .where(eq(userTelegram.userId, user.id))
    .limit(1);

  if (existing) {
    // Update token but preserve connectedAt if already set
    await db
      .update(userTelegram)
      .set({ connectToken: token })
      .where(eq(userTelegram.userId, user.id));
  } else {
    await db.insert(userTelegram).values({
      userId: user.id,
      connectToken: token,
    });
  }

  const deepLink = `https://t.me/AMALabsBot?start=${token}`;
  return NextResponse.json({ token, deepLink });
}
