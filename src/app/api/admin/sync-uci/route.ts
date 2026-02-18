import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db, uciSyncRuns } from "@/lib/db";
import { desc } from "drizzle-orm";
import { syncUciDatabase } from "@/lib/scraper/sync-uci-database";

/**
 * GET /api/admin/sync-uci - Get recent sync runs
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runs = await db
    .select()
    .from(uciSyncRuns)
    .orderBy(desc(uciSyncRuns.startedAt))
    .limit(10);

  return NextResponse.json({ runs });
}

/**
 * POST /api/admin/sync-uci - Trigger a manual sync
 */
export async function POST() {
  try {
    await requireAdmin();
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncUciDatabase({ discipline: "mtb" });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Admin sync error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
