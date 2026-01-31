import { NextResponse } from "next/server";
import { db, races, raceStartlist, riders } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, createRaceSchema } from "@/lib/validations";
import { parseStartlist, normalizeRiderName } from "@/lib/scraper/startlist-parser";
import { eq, desc, gte, and, ilike } from "drizzle-orm";

export async function GET(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "api");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const discipline = searchParams.get("discipline");
  const upcoming = searchParams.get("upcoming") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Build where conditions
    const conditions = [];
    if (status) {
      conditions.push(eq(races.status, status));
    }
    if (discipline) {
      conditions.push(eq(races.discipline, discipline));
    }
    if (upcoming) {
      const today = new Date().toISOString().split("T")[0];
      conditions.push(gte(races.date, today));
    }

    const raceList = await db
      .select()
      .from(races)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(upcoming ? races.date : desc(races.date))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      races: raceList,
      pagination: {
        limit,
        offset,
        hasMore: raceList.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching races:", error);
    return NextResponse.json(
      { error: "Failed to fetch races" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "api");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate body
  const { data, error } = await validateBody(request, createRaceSchema);
  if (error) return error;

  try {
    // Create the race
    const [newRace] = await db
      .insert(races)
      .values({
        name: data.name,
        date: data.date,
        discipline: data.discipline,
        raceType: data.raceType,
        profileType: data.profileType,
        ageCategory: data.ageCategory,
        gender: data.gender,
        distanceKm: data.distanceKm?.toString(),
        elevationM: data.elevationM,
        uciCategory: data.uciCategory,
        country: data.country,
        startlistUrl: data.startlistUrl,
        pcsUrl: data.pcsUrl,
        submittedBy: user.id,
        status: "active",
      })
      .returning();

    // If startlist URL provided, parse and add riders
    if (data.startlistUrl) {
      try {
        const startlist = await parseStartlist(data.startlistUrl);

        // Match riders to database or create new ones
        for (const entry of startlist.entries) {
          const normalizedName = normalizeRiderName(entry.riderName);

          // Try to find existing rider
          let [existingRider] = await db
            .select()
            .from(riders)
            .where(ilike(riders.name, normalizedName))
            .limit(1);

          // If not found by name, try by source ID
          if (!existingRider && entry.sourceId && entry.sourceType === "pcs") {
            [existingRider] = await db
              .select()
              .from(riders)
              .where(eq(riders.pcsId, entry.sourceId))
              .limit(1);
          }

          // Create rider if not found
          if (!existingRider) {
            [existingRider] = await db
              .insert(riders)
              .values({
                name: normalizedName,
                nationality: entry.nationality,
                pcsId: entry.sourceType === "pcs" ? entry.sourceId : null,
              })
              .returning();
          }

          // Add to startlist
          await db.insert(raceStartlist).values({
            raceId: newRace.id,
            riderId: existingRider.id,
            bibNumber: entry.bibNumber,
            status: "confirmed",
          });
        }
      } catch (parseError) {
        console.error("Error parsing startlist:", parseError);
        // Don't fail the race creation, just log the error
      }
    }

    return NextResponse.json(newRace, { status: 201 });
  } catch (error) {
    console.error("Error creating race:", error);
    return NextResponse.json(
      { error: "Failed to create race" },
      { status: 500 }
    );
  }
}
