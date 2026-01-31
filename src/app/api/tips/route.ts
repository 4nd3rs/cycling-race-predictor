import { NextResponse } from "next/server";
import { db, userTips, riders, races, users } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, submitTipSchema } from "@/lib/validations";
import { eq, desc, and } from "drizzle-orm";

export async function GET(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "api");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const riderId = searchParams.get("riderId");
  const raceId = searchParams.get("raceId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

  try {
    let query = db
      .select({
        tip: userTips,
        rider: riders,
        race: races,
      })
      .from(userTips)
      .innerJoin(riders, eq(userTips.riderId, riders.id))
      .leftJoin(races, eq(userTips.raceId, races.id))
      .where(eq(userTips.processed, true));

    const conditions = [eq(userTips.processed, true)];
    if (riderId) {
      conditions.push(eq(userTips.riderId, riderId));
    }
    if (raceId) {
      conditions.push(eq(userTips.raceId, raceId));
    }

    if (conditions.length > 1) {
      query = db
        .select({
          tip: userTips,
          rider: riders,
          race: races,
        })
        .from(userTips)
        .innerJoin(riders, eq(userTips.riderId, riders.id))
        .leftJoin(races, eq(userTips.raceId, races.id))
        .where(and(...conditions));
    }

    const tips = await query.orderBy(desc(userTips.createdAt)).limit(limit);

    return NextResponse.json({
      tips: tips.map(({ tip, rider, race }) => ({
        id: tip.id,
        riderId: rider.id,
        riderName: rider.name,
        raceId: race?.id,
        raceName: race?.name,
        tipText: tip.tipText,
        tipType: tip.tipType,
        sentiment: parseFloat(tip.sentiment || "0"),
        createdAt: tip.createdAt,
      })),
    });
  } catch (err) {
    console.error("Error fetching tips:", err);
    return NextResponse.json(
      { error: "Failed to fetch tips" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  // Rate limit (stricter for tips)
  const rateLimitResponse = await withRateLimit(request, "tip");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate body
  const { data, error } = await validateBody(request, submitTipSchema);
  if (error) return error;

  try {
    // Verify rider exists
    const [rider] = await db
      .select()
      .from(riders)
      .where(eq(riders.id, data.riderId))
      .limit(1);

    if (!rider) {
      return NextResponse.json({ error: "Rider not found" }, { status: 404 });
    }

    // Verify race exists (if provided)
    if (data.raceId) {
      const [race] = await db
        .select()
        .from(races)
        .where(eq(races.id, data.raceId))
        .limit(1);

      if (!race) {
        return NextResponse.json({ error: "Race not found" }, { status: 404 });
      }
    }

    // Create the tip (will be processed by cron job)
    const [newTip] = await db
      .insert(userTips)
      .values({
        userId: user.id,
        riderId: data.riderId,
        raceId: data.raceId,
        tipText: data.tipText,
        tipType: data.tipType,
        processed: false,
      })
      .returning();

    // Update user's tip count
    await db
      .update(users)
      .set({
        tipsSubmitted: (
          await db
            .select({ count: userTips.id })
            .from(userTips)
            .where(eq(userTips.userId, user.id))
        ).length,
      })
      .where(eq(users.id, user.id));

    return NextResponse.json(
      {
        id: newTip.id,
        message:
          "Tip submitted successfully. It will be processed and added to community intel.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Error submitting tip:", err);
    return NextResponse.json(
      { error: "Failed to submit tip" },
      { status: 500 }
    );
  }
}
