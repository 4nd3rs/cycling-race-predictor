import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db, userTips, riders, users, riderRumours } from "@/lib/db";
import {
  parseTip,
  calculateTipWeight,
  aggregateTips,
  generateRumourSummary,
} from "@/lib/ai";
import { eq, and, sql, desc } from "drizzle-orm";

// Vercel cron jobs are authenticated via CRON_SECRET header
async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  // In development, allow without auth
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // Verify Vercel's cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("CRON_SECRET not set");
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET() {
  // Verify cron authentication
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ tipId: string; status: string; sentiment?: number }> =
    [];

  try {
    // Get unprocessed tips (limit to batch size)
    const unprocessedTips = await db
      .select({
        tip: userTips,
        rider: riders,
        user: users,
      })
      .from(userTips)
      .innerJoin(riders, eq(userTips.riderId, riders.id))
      .innerJoin(users, eq(userTips.userId, users.id))
      .where(eq(userTips.processed, false))
      .limit(20); // Process 20 tips per run

    for (const { tip, rider, user } of unprocessedTips) {
      try {
        // Parse tip with Gemini AI
        const parsed = await parseTip(tip.tipText, rider.name);

        if (parsed.isSpam) {
          // Mark as processed but don't use
          await db
            .update(userTips)
            .set({
              processed: true,
              sentiment: "0",
              extractedCategory: "spam",
              extractedConfidence: "0",
              weight: "0",
            })
            .where(eq(userTips.id, tip.id));

          results.push({
            tipId: tip.id,
            status: "spam",
          });
          continue;
        }

        // Find corroborating tips (similar tips from other users)
        const similarTips = await db
          .select()
          .from(userTips)
          .where(
            and(
              eq(userTips.riderId, tip.riderId),
              eq(userTips.processed, true),
              sql`ABS(CAST(${userTips.sentiment} AS DECIMAL) - ${parsed.sentiment}) < 0.3`
            )
          )
          .limit(10);

        // Calculate tip weight
        const daysSinceSubmission = Math.floor(
          (Date.now() - new Date(tip.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );

        const weight = calculateTipWeight(
          parsed,
          parseFloat(user.tipAccuracyScore || "0.5"),
          similarTips.length,
          daysSinceSubmission
        );

        // Update tip with parsed data
        await db
          .update(userTips)
          .set({
            processed: true,
            sentiment: parsed.sentiment.toString(),
            tipType: parsed.category,
            extractedCategory: parsed.category,
            extractedConfidence: parsed.confidence.toString(),
            weight: weight.toString(),
            aiReasoning: parsed.reasoning,
          })
          .where(eq(userTips.id, tip.id));

        results.push({
          tipId: tip.id,
          status: "processed",
          sentiment: parsed.sentiment,
        });

        // Update rider rumour aggregate
        await updateRiderRumours(tip.riderId);
      } catch (error) {
        console.error(`Error processing tip ${tip.id}:`, error);
        results.push({
          tipId: tip.id,
          status: "error",
        });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("Cron process-tips error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Update the aggregate rumour score for a rider
 */
async function updateRiderRumours(riderId: string): Promise<void> {
  // Get all processed tips for this rider
  const tips = await db
    .select()
    .from(userTips)
    .where(
      and(eq(userTips.riderId, riderId), eq(userTips.processed, true))
    )
    .orderBy(desc(userTips.createdAt))
    .limit(20);

  if (tips.length === 0) {
    return;
  }

  // Calculate aggregate
  const tipsWithWeight = tips.map((t) => ({
    sentiment: parseFloat(t.sentiment || "0"),
    weight: parseFloat(t.weight || "0.5"),
  }));

  const { aggregateScore } = aggregateTips(tipsWithWeight);

  // Generate summary
  const tipsForSummary = tips.slice(0, 5).map((t) => ({
    tipText: t.tipText,
    sentiment: parseFloat(t.sentiment || "0"),
    category: (t.tipType || "other") as "injury" | "form" | "motivation" | "team_dynamics" | "equipment" | "other",
  }));

  const summary = await generateRumourSummary(tipsForSummary);

  // Upsert rumour record
  const [existing] = await db
    .select()
    .from(riderRumours)
    .where(eq(riderRumours.riderId, riderId))
    .limit(1);

  if (existing) {
    await db
      .update(riderRumours)
      .set({
        aggregateScore: aggregateScore.toString(),
        tipCount: tips.length,
        summary,
        lastUpdated: new Date(),
      })
      .where(eq(riderRumours.id, existing.id));
  } else {
    await db.insert(riderRumours).values({
      riderId,
      aggregateScore: aggregateScore.toString(),
      tipCount: tips.length,
      summary,
    });
  }
}

// Support POST for manual triggers
export async function POST() {
  return GET();
}
