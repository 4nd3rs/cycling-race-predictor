import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows, riders, raceEvents } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET() {
  const user = await requireAuth();

  const follows = await db
    .select()
    .from(userFollows)
    .where(eq(userFollows.userId, user.id));

  // Enrich with entity details
  const enriched = await Promise.all(
    follows.map(async (f) => {
      if (f.followType === "rider") {
        const [rider] = await db
          .select({ id: riders.id, name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
          .from(riders)
          .where(eq(riders.id, f.entityId))
          .limit(1);
        return { ...f, entity: rider || null };
      } else {
        const [event] = await db
          .select({ id: raceEvents.id, name: raceEvents.name, discipline: raceEvents.discipline, date: raceEvents.date, slug: raceEvents.slug })
          .from(raceEvents)
          .where(eq(raceEvents.id, f.entityId))
          .limit(1);
        return { ...f, entity: event || null };
      }
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const user = await requireAuth();
  const { followType, entityId } = await req.json();

  if (!followType || !entityId) {
    return NextResponse.json({ error: "followType and entityId are required" }, { status: 400 });
  }

  await db
    .insert(userFollows)
    .values({ userId: user.id, followType, entityId })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth();
  const { followType, entityId } = await req.json();

  if (!followType || !entityId) {
    return NextResponse.json({ error: "followType and entityId are required" }, { status: 400 });
  }

  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.userId, user.id),
        eq(userFollows.followType, followType),
        eq(userFollows.entityId, entityId)
      )
    );

  return NextResponse.json({ ok: true });
}
