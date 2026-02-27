import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db, userTelegram } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await db.delete(userTelegram).where(eq(userTelegram.userId, user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
