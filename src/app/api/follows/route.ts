import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows, riders, raceEvents, races, teams } from "@/lib/db";
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
      } else if (f.followType === "race") {
        const [race] = await db
          .select({ id: races.id, name: races.name, discipline: races.discipline, date: races.date })
          .from(races)
          .where(eq(races.id, f.entityId))
          .limit(1);
        return { ...f, entity: race || null };
      } else if (f.followType === "team") {
        const [team] = await db
          .select({ id: teams.id, name: teams.name, slug: teams.slug, logoUrl: teams.logoUrl })
          .from(teams)
          .where(eq(teams.id, f.entityId))
          .limit(1);
        return { ...f, entity: team || null };
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
  try {
  const user = await requireAuth();
  const { followType, entityId } = await req.json();

  if (!followType || !entityId) {
    return NextResponse.json({ error: "followType and entityId are required" }, { status: 400 });
  }

  const result = await db
    .insert(userFollows)
    .values({ userId: user.id, followType, entityId })
    .onConflictDoNothing()
    .returning();

  // Only notify on a new follow (not a duplicate)
  if (result.length > 0) {
    // Await so Vercel doesn't kill the function before it completes
    await sendFollowNotification(user.id, followType, entityId).catch((err) =>
      console.error("Follow notification failed:", err)
    );
  }

  return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[follows POST]", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
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
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[follows DELETE]", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

async function sendFollowNotification(
  _userId: string,
  _followType: string,
  _entityId: string
): Promise<void> {
  // Telegram notifications removed — WhatsApp group handles race updates
  return;
}
