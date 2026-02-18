import { NextResponse } from "next/server";
import { syncUciDatabase } from "@/lib/scraper/sync-uci-database";

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
 * Scheduled for Tuesdays (UCI updates on Tuesdays).
 * Use ?force=true to run on any day.
 *
 * POST /api/cron/sync-mtb-rankings
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  // Only run on Tuesdays (UTC day 2) unless forced
  const today = new Date();
  if (!force && today.getUTCDay() !== 2) {
    return NextResponse.json({
      skipped: true,
      reason: "Not Tuesday (UTC). Use ?force=true to override.",
      dayOfWeek: today.getUTCDay(),
    });
  }

  try {
    const result = await syncUciDatabase({ discipline: "mtb" });

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cron sync error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (still requires auth)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Forward to POST handler with force flag
  const url = new URL(request.url);
  url.searchParams.set("force", "true");
  const modifiedRequest = new Request(url.toString(), {
    method: "POST",
    headers: request.headers,
  });
  return POST(modifiedRequest);
}
