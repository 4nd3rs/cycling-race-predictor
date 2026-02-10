import { NextResponse } from "next/server";
import { db, riders, riderDisciplineStats } from "@/lib/db";
import { scrapeXCOdataRankings, type XCOdataCategory } from "@/lib/scraper/xcodata";
import { normalizeRiderName } from "@/lib/scraper/startlist-parser";
import { eq, ilike, and } from "drizzle-orm";

// Verify cron secret to prevent unauthorized access
function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("CRON_SECRET not configured");
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Sync UCI MTB rankings from XCOdata
 * This endpoint is designed to be called by a cron job (e.g., weekly via Vercel cron)
 *
 * POST /api/cron/sync-mtb-rankings
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = {
    categoriesProcessed: 0,
    ridersUpdated: 0,
    ridersCreated: 0,
    errors: [] as string[],
  };

  const categories: XCOdataCategory[] = [
    "men_elite",
    "women_elite",
    "men_junior",
    "women_junior",
  ];

  for (const category of categories) {
    try {
      console.log(`Syncing ${category} rankings...`);

      // Parse category into ageCategory and gender
      const [gender, ageCategory] = category.split("_");

      // Fetch rankings (limit to top 500 for efficiency)
      const rankings = await scrapeXCOdataRankings(ageCategory, gender, 20);

      if (rankings.length === 0) {
        stats.errors.push(`No rankings found for ${category}`);
        continue;
      }

      console.log(`Processing ${rankings.length} riders for ${category}`);

      for (const ranking of rankings) {
        try {
          const normalizedName = normalizeRiderName(ranking.name);

          // Try to find existing rider by XCO ID
          let [existingRider] = ranking.xcoId
            ? await db
                .select()
                .from(riders)
                .where(eq(riders.xcoId, ranking.xcoId))
                .limit(1)
            : [null];

          // Try by name if not found by ID
          if (!existingRider) {
            [existingRider] = await db
              .select()
              .from(riders)
              .where(ilike(riders.name, normalizedName))
              .limit(1);
          }

          if (!existingRider) {
            // Create new rider
            [existingRider] = await db
              .insert(riders)
              .values({
                name: normalizedName,
                nationality: ranking.nationality || null,
                xcoId: ranking.xcoId || null,
              })
              .returning();
            stats.ridersCreated++;
          } else {
            // Update xcoId and nationality if not set
            const updates: { xcoId?: string; nationality?: string } = {};
            if (ranking.xcoId && !existingRider.xcoId) {
              updates.xcoId = ranking.xcoId;
            }
            if (ranking.nationality && !existingRider.nationality) {
              updates.nationality = ranking.nationality;
            }
            if (Object.keys(updates).length > 0) {
              await db
                .update(riders)
                .set(updates)
                .where(eq(riders.id, existingRider.id));
            }
            stats.ridersUpdated++;
          }

          // Update or create discipline stats
          // For MTB XCO, use UCI points to estimate Elo
          // Higher UCI points = better rider = higher Elo
          // Top rider (~3000 pts) = ~2000 Elo
          // Average ranked rider (~500 pts) = ~1600 Elo
          const estimatedElo = 1500 + (ranking.uciPoints / 3000) * 500;

          const [existingStats] = await db
            .select()
            .from(riderDisciplineStats)
            .where(
              and(
                eq(riderDisciplineStats.riderId, existingRider.id),
                eq(riderDisciplineStats.discipline, "mtb_xco"),
                eq(riderDisciplineStats.ageCategory, ageCategory)
              )
            )
            .limit(1);

          if (!existingStats) {
            await db.insert(riderDisciplineStats).values({
              riderId: existingRider.id,
              discipline: "mtb_xco",
              ageCategory,
              currentElo: estimatedElo.toFixed(2),
              eloMean: estimatedElo.toFixed(4),
              eloVariance: "350.0000", // High variance for initial estimates
            });
          } else {
            // Only update if UCI points suggest a significant change
            const currentElo = parseFloat(existingStats.currentElo || "1500");
            const eloDiff = Math.abs(estimatedElo - currentElo);

            // Only update if difference is significant (> 50 points)
            // This prevents overwriting calculated Elo with estimates
            if (eloDiff > 50 && (existingStats.racesTotal || 0) < 3) {
              await db
                .update(riderDisciplineStats)
                .set({
                  currentElo: estimatedElo.toFixed(2),
                  eloMean: estimatedElo.toFixed(4),
                  updatedAt: new Date(),
                })
                .where(eq(riderDisciplineStats.id, existingStats.id));
            }
          }
        } catch (riderError) {
          console.error(`Error processing rider ${ranking.name}:`, riderError);
        }
      }

      stats.categoriesProcessed++;
    } catch (categoryError) {
      const errorMsg = `Error processing ${category}: ${categoryError instanceof Error ? categoryError.message : "Unknown error"}`;
      console.error(errorMsg);
      stats.errors.push(errorMsg);
    }
  }

  return NextResponse.json({
    success: true,
    stats,
    timestamp: new Date().toISOString(),
  });
}

// Also support GET for manual testing (still requires auth)
export async function GET(request: Request) {
  // For GET, check for query param secret as alternative
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Forward to POST handler
  return POST(request);
}
