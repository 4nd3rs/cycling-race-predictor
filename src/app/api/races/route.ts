import { NextResponse } from "next/server";
import { db, races, raceStartlist, riders, raceEvents } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, createRaceSchema } from "@/lib/validations";
import { parseStartlist, normalizeRiderName } from "@/lib/scraper/startlist-parser";
import { eq, desc, gte, and, ilike } from "drizzle-orm";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "@/lib/url-utils";

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
    // Generate category slug
    const categorySlug = generateCategorySlug(data.ageCategory, data.gender);

    // For standalone races (no event), auto-create a raceEvent
    // Generate unique event slug
    const baseEventSlug = generateEventSlug(data.name);
    const existingEvents = await db
      .select({ slug: raceEvents.slug })
      .from(raceEvents)
      .where(eq(raceEvents.discipline, data.discipline));

    const existingSlugs = new Set(
      existingEvents.map((e) => e.slug).filter(Boolean) as string[]
    );
    const eventSlug = makeSlugUnique(baseEventSlug, existingSlugs);

    // Create the race event first
    const [newEvent] = await db
      .insert(raceEvents)
      .values({
        name: data.name,
        slug: eventSlug,
        date: data.date,
        discipline: data.discipline,
        subDiscipline: data.subDiscipline || null,
        country: data.country,
        sourceUrl: data.startlistUrl || data.pcsUrl,
        sourceType: data.pcsUrl ? "procyclingstats" : null,
      })
      .returning();

    // Create the race linked to the event
    const [newRace] = await db
      .insert(races)
      .values({
        name: data.name,
        categorySlug,
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
        raceEventId: newEvent.id,
      })
      .returning();

    // Handle startlist entries (either passed directly or parsed from URL)
    const startlistEntries = data.startlistEntries || [];

    // If entries provided directly (from pre-parsed data), use them
    if (startlistEntries.length > 0) {
      for (const entry of startlistEntries) {
        const normalizedName = normalizeRiderName(entry.riderName);

        // Try to find existing rider by PCS ID first
        let existingRider = null;
        if (entry.riderPcsId) {
          [existingRider] = await db
            .select()
            .from(riders)
            .where(eq(riders.pcsId, entry.riderPcsId))
            .limit(1);
        }

        // If not found, try by name
        if (!existingRider) {
          [existingRider] = await db
            .select()
            .from(riders)
            .where(ilike(riders.name, normalizedName))
            .limit(1);
        }

        // Create rider if not found
        if (!existingRider) {
          [existingRider] = await db
            .insert(riders)
            .values({
              name: normalizedName,
              pcsId: entry.riderPcsId || null,
            })
            .returning();
        }

        // Add to startlist
        await db.insert(raceStartlist).values({
          raceId: newRace.id,
          riderId: existingRider.id,
          bibNumber: entry.bibNumber || null,
          status: "confirmed",
        }).onConflictDoNothing();
      }
    }
    // Otherwise, if startlist URL provided but no entries, parse the URL
    else if (data.startlistUrl) {
      try {
        const startlist = await parseStartlist(data.startlistUrl);

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
          }).onConflictDoNothing();
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
