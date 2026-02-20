import { NextRequest, NextResponse } from "next/server";
import { db, raceEvents, races, raceResults, raceStartlist } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateEventSchema = z.object({
  name: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  country: z.string().length(3).nullable().optional(),
  series: z.string().max(50).nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  sourceType: z.string().max(50).nullable().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await db.query.raceEvents.findFirst({
      where: eq(raceEvents.id, id),
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Get associated races
    const eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, id));

    return NextResponse.json({ event, races: eventRaces });
  } catch (error) {
    console.error("Error fetching event:", error);
    return NextResponse.json(
      { error: "Failed to fetch event" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const validation = updateEventSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Check event exists
    const existingEvent = await db.query.raceEvents.findFirst({
      where: eq(raceEvents.id, id),
    });

    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Update event
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.date !== undefined) updateData.date = data.date;
    if (data.endDate !== undefined) updateData.endDate = data.endDate;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.series !== undefined) updateData.series = data.series;
    if (data.sourceUrl !== undefined) updateData.sourceUrl = data.sourceUrl;
    if (data.sourceType !== undefined) updateData.sourceType = data.sourceType;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(raceEvents)
        .set(updateData)
        .where(eq(raceEvents.id, id));

      // Also update the date on associated races if event date changed
      if (data.date !== undefined) {
        await db
          .update(races)
          .set({ date: data.date })
          .where(eq(races.raceEventId, id));
      }
    }

    // Return updated event
    const updatedEvent = await db.query.raceEvents.findFirst({
      where: eq(raceEvents.id, id),
    });

    return NextResponse.json({ event: updatedEvent });
  } catch (error) {
    console.error("Error updating event:", error);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check event exists
    const existingEvent = await db.query.raceEvents.findFirst({
      where: eq(raceEvents.id, id),
    });

    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Get associated races
    const eventRaces = await db
      .select({ id: races.id })
      .from(races)
      .where(eq(races.raceEventId, id));

    const raceIds = eventRaces.map((r) => r.id);

    // Delete results and startlist entries for all races
    for (const raceId of raceIds) {
      await db.delete(raceResults).where(eq(raceResults.raceId, raceId));
      await db.delete(raceStartlist).where(eq(raceStartlist.raceId, raceId));
    }

    // Delete all races associated with this event
    await db.delete(races).where(eq(races.raceEventId, id));

    // Delete the event
    await db.delete(raceEvents).where(eq(raceEvents.id, id));

    return NextResponse.json({
      success: true,
      deleted: {
        eventId: id,
        racesDeleted: raceIds.length,
      },
    });
  } catch (error) {
    console.error("Error deleting event:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
