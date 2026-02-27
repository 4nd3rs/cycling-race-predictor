import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows, riders, raceEvents, races, teams, userTelegram } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { sendTelegramMessage } from "@/lib/telegram";

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
    // Fire-and-forget — don't block the response
    sendFollowNotification(user.id, followType, entityId).catch((err) =>
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
  userId: string,
  followType: string,
  entityId: string
): Promise<void> {
  // Check if user has Telegram connected
  const [tg] = await db
    .select({ telegramChatId: userTelegram.telegramChatId })
    .from(userTelegram)
    .where(eq(userTelegram.userId, userId))
    .limit(1);

  if (!tg?.telegramChatId) return;

  // Look up entity name + link
  let entityName: string | null = null;
  let entityUrl: string | null = null;

  if (followType === "rider") {
    const [rider] = await db
      .select({ name: riders.name })
      .from(riders)
      .where(eq(riders.id, entityId))
      .limit(1);
    if (rider) {
      entityName = rider.name;
      entityUrl = `https://procyclingpredictor.com/riders/${entityId}`;
    }
  } else if (followType === "race") {
    const [race] = await db
      .select({ name: races.name, raceEventId: races.raceEventId, discipline: races.discipline })
      .from(races)
      .where(eq(races.id, entityId))
      .limit(1);
    if (race) {
      entityName = race.name;
      // Build URL from race_event if possible
      if (race.raceEventId) {
        const [ev] = await db
          .select({ slug: raceEvents.slug, discipline: raceEvents.discipline })
          .from(raceEvents)
          .where(eq(raceEvents.id, race.raceEventId))
          .limit(1);
        entityUrl = ev?.slug
          ? `https://procyclingpredictor.com/races/${ev.discipline}/${ev.slug}`
          : `https://procyclingpredictor.com`;
      } else {
        entityUrl = `https://procyclingpredictor.com`;
      }
    }
  } else if (followType === "race_event") {
    const [event] = await db
      .select({ name: raceEvents.name, slug: raceEvents.slug, discipline: raceEvents.discipline })
      .from(raceEvents)
      .where(eq(raceEvents.id, entityId))
      .limit(1);
    if (event) {
      entityName = event.name;
      entityUrl = event.slug
        ? `https://procyclingpredictor.com/races/${event.discipline}/${event.slug}`
        : `https://procyclingpredictor.com`;
    }
  } else if (followType === "team") {
    const [team] = await db
      .select({ name: teams.name, slug: teams.slug })
      .from(teams)
      .where(eq(teams.id, entityId))
      .limit(1);
    if (team) {
      entityName = team.name;
      entityUrl = `https://procyclingpredictor.com/teams/${team.slug || entityId}`;
    }
  }

  if (!entityName) return;

  const emoji = followType === "rider" ? "🚴" : followType === "team" ? "👥" : "🏁";
  const typeLabel = followType === "rider" ? "rider" : followType === "team" ? "team" : "race";

  const message = [
    `${emoji} <b>You're now following ${entityName}!</b>`,
    ``,
    `You'll get Telegram updates for this ${typeLabel} — predictions, results, and breaking news.`,
    ``,
    `👉 <a href="${entityUrl}">${entityName} on Pro Cycling Predictor</a>`,
    ``,
    `<i>Manage your follows at procyclingpredictor.com</i>`,
  ].join("\n");

  await sendTelegramMessage(tg.telegramChatId, message);
}
