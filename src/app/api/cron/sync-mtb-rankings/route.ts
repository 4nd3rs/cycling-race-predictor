import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { syncUciDatabase } from "@/lib/scraper/sync-uci-database";

export const maxDuration = 60;

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only run on Tuesdays (UTC day 2) unless in development
  const today = new Date();
  if (process.env.NODE_ENV !== "development" && today.getUTCDay() !== 2) {
    return NextResponse.json({
      skipped: true,
      reason: "Not Tuesday (UTC)",
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

export async function POST() {
  return GET();
}
