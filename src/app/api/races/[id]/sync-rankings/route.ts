import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { syncUciRankingsForRace } from "@/lib/scraper/sync-uci-rankings";
import { db, predictions } from "@/lib/db";
import { eq } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  // Rate limit (stricter for scraping)
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: raceId } = await context.params;

  try {
    console.log(`Syncing UCI rankings for race ${raceId}...`);
    const result = await syncUciRankingsForRace(raceId);

    // Delete existing predictions so they regenerate with new data
    if (result.synced > 0 || result.cleaned > 0) {
      const deleted = await db
        .delete(predictions)
        .where(eq(predictions.raceId, raceId))
        .returning({ id: predictions.id });
      console.log(`Deleted ${deleted.length} old predictions for regeneration`);
    }

    const cleanedMsg = result.cleaned > 0 ? ` Removed ${result.cleaned} misclassified rider(s).` : "";
    return NextResponse.json({
      success: true,
      ...result,
      message: `Synced ${result.synced} riders with UCI rankings.${cleanedMsg} Predictions will regenerate on next page load.`,
    });
  } catch (error) {
    console.error("Error syncing UCI rankings:", error);

    // Check if it's a network/scraping error
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("HTTP 500") || errorMessage.includes("Failed to fetch")) {
      return NextResponse.json(
        {
          error: "UCI ranking source (XCOdata.com) is temporarily unavailable. Please try again later.",
          details: errorMessage,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to sync UCI rankings", details: errorMessage },
      { status: 500 }
    );
  }
}
