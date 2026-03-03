import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db, userFollows } from "@/lib/db";
import { eq, and, inArray, sql } from "drizzle-orm";

// POST /api/follows/check-batch
// Body: { items: Array<{ followType: string; entityId: string }> }
// Returns: { results: Record<"followType:entityId", boolean> }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { items } = await req.json() as {
      items: Array<{ followType: string; entityId: string }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // Cap batch size to avoid abuse
    const batch = items.slice(0, 100);

    // Fetch all matching follows in a single query using OR conditions
    const rows = await db
      .select({ followType: userFollows.followType, entityId: userFollows.entityId })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.userId, user.id),
          sql`(${userFollows.followType}, ${userFollows.entityId}) IN (${sql.join(
            batch.map((i) => sql`(${i.followType}, ${i.entityId})`),
            sql`, `
          )})`
        )
      );

    const found = new Set(rows.map((r) => `${r.followType}:${r.entityId}`));
    const results: Record<string, boolean> = {};
    for (const item of batch) {
      results[`${item.followType}:${item.entityId}`] = found.has(`${item.followType}:${item.entityId}`);
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[follows/check-batch]", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
