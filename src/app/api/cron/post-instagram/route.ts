/**
 * POST /api/cron/post-instagram
 * Finds upcoming road races, generates a story card via /api/og/instagram-card,
 * and posts to Instagram @procyclingpredictor.
 */
import { NextRequest, NextResponse } from "next/server";
import { db, races, raceEvents } from "@/lib/db";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";

const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID ?? "25144018075271509";
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN!;
const APP_URL = "https://procyclingpredictor.com";
const CRON_SECRET = process.env.CRON_SECRET!;

function dayRange(offsetMin: number, offsetMax: number) {
  const min = new Date(); min.setDate(min.getDate() + offsetMin);
  const max = new Date(); max.setDate(max.getDate() + offsetMax);
  return { min: min.toISOString().slice(0, 10), max: max.toISOString().slice(0, 10) };
}

async function postStory(imageUrl: string, caption: string): Promise<string> {
  // Step 1: Create container
  const containerRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        media_type: "STORIES",
        caption,
        access_token: IG_TOKEN,
      }),
    }
  );
  const container = await containerRes.json();
  if (!container.id) throw new Error(`Container error: ${JSON.stringify(container)}`);

  // Wait for container to be ready
  await new Promise((r) => setTimeout(r, 4000));

  // Step 2: Publish
  const publishRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: IG_TOKEN,
      }),
    }
  );
  const pub = await publishRes.json();
  if (!pub.id) throw new Error(`Publish error: ${JSON.stringify(pub)}`);
  return pub.id;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { min, max } = dayRange(0, 2);
  const upcoming = await db
    .select({ id: races.id, eventSlug: raceEvents.slug, eventName: raceEvents.name, date: races.date, discipline: races.discipline })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, "road"),
      isNotNull(raceEvents.slug),
      gte(races.date, min),
      lte(races.date, max),
      eq(races.status, "active"),
    ))
    .limit(2);

  if (upcoming.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No upcoming road races in next 48h" });
  }

  const results = [];
  for (const race of upcoming) {
    const slug = race.eventSlug!;
    const imageUrl = `${APP_URL}/api/og/instagram-card?event=${slug}&type=preview&gender=men`;
    const caption = `Race preview: ${race.eventName} 🚴\n\nFull predictions and startlist 👉 ${APP_URL}/races/road/${slug}\n\n#cycling #procycling #roadcycling #predictions`;

    try {
      const mediaId = await postStory(imageUrl, caption);
      results.push({ slug, mediaId, ok: true });
    } catch (err: any) {
      results.push({ slug, error: err.message, ok: false });
    }
  }

  return NextResponse.json({ results });
}
