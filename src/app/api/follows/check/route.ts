import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
  const user = await requireAuth();

  const followType = req.nextUrl.searchParams.get("followType");
  const entityId = req.nextUrl.searchParams.get("entityId");

  if (!followType || !entityId) {
    return NextResponse.json({ error: "followType and entityId are required" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: userFollows.id })
    .from(userFollows)
    .where(
      and(
        eq(userFollows.userId, user.id),
        eq(userFollows.followType, followType),
        eq(userFollows.entityId, entityId)
      )
    )
    .limit(1);

  return NextResponse.json({ following: !!existing });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[follows/check]", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
