import { NextResponse } from "next/server";
import { db, races, raceResults, raceStartlist, predictions } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the race first to verify it exists
    const [race] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Delete all related data first (foreign key constraints)
    await db.delete(raceResults).where(eq(raceResults.raceId, id));
    await db.delete(raceStartlist).where(eq(raceStartlist.raceId, id));
    await db.delete(predictions).where(eq(predictions.raceId, id));

    // Delete the race
    await db.delete(races).where(eq(races.id, id));

    return NextResponse.json({ success: true, deletedRace: race.name });
  } catch (error) {
    console.error("Error deleting race:", error);
    return NextResponse.json(
      { error: "Failed to delete race" },
      { status: 500 }
    );
  }
}
