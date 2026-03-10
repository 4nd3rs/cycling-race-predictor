import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows, riders, raceEvents, races, teams } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";

export async function GET() {
  const user = await requireAuth();

  const follows = await db
    .select()
    .from(userFollows)
    .where(eq(userFollows.userId, user.id));

  // Group entityIds by followType
  const riderIds: string[] = [];
  const raceIds: string[] = [];
  const teamIds: string[] = [];
  const eventIds: string[] = [];

  for (const f of follows) {
    if (f.followType === "rider") riderIds.push(f.entityId);
    else if (f.followType === "race") raceIds.push(f.entityId);
    else if (f.followType === "team") teamIds.push(f.entityId);
    else eventIds.push(f.entityId);
  }

  // Batch-fetch all entities in parallel
  const [riderRows, raceRows, teamRows, eventRows] = await Promise.all([
    riderIds.length > 0
      ? db
          .select({ id: riders.id, name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
          .from(riders)
          .where(inArray(riders.id, riderIds))
      : [],
    raceIds.length > 0
      ? db
          .select({ id: races.id, name: races.name, discipline: races.discipline, date: races.date })
          .from(races)
          .where(inArray(races.id, raceIds))
      : [],
    teamIds.length > 0
      ? db
          .select({ id: teams.id, name: teams.name, slug: teams.slug, logoUrl: teams.logoUrl })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [],
    eventIds.length > 0
      ? db
          .select({ id: raceEvents.id, name: raceEvents.name, discipline: raceEvents.discipline, date: raceEvents.date, slug: raceEvents.slug })
          .from(raceEvents)
          .where(inArray(raceEvents.id, eventIds))
      : [],
  ]);

  // Build lookup maps for O(1) access
  const riderMap = new Map(riderRows.map((r) => [r.id, r]));
  const raceMap = new Map(raceRows.map((r) => [r.id, r]));
  const teamMap = new Map(teamRows.map((t) => [t.id, t]));
  const eventMap = new Map(eventRows.map((e) => [e.id, e]));

  // Enrich follows with entity details
  const enriched = follows.map((f) => {
    let entity = null;
    if (f.followType === "rider") entity = riderMap.get(f.entityId) ?? null;
    else if (f.followType === "race") entity = raceMap.get(f.entityId) ?? null;
    else if (f.followType === "team") entity = teamMap.get(f.entityId) ?? null;
    else entity = eventMap.get(f.entityId) ?? null;
    return { ...f, entity };
  });

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  try {
  const user = await requireAuth();
  const { followType, entityId } = await req.json();

  if (!followType || !entityId) {
    return NextResponse.json({ error: "followType and entityId are required" }, { status: 400 });
  }

  await db
    .insert(userFollows)
    .values({ userId: user.id, followType, entityId })
    .onConflictDoNothing()
    .returning();

  return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[follows POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
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
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[follows DELETE]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
