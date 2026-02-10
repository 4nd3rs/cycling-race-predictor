import { NextResponse } from "next/server";
import { db, raceEvents, races, raceStartlist, riders, teams } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, createMtbEventSchema } from "@/lib/validations";
import { mapCategory, getCategoryDisplayName } from "@/lib/scraper/rockthesport";
import { normalizeRiderName } from "@/lib/scraper/startlist-parser";
import { eq, ilike } from "drizzle-orm";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "@/lib/url-utils";

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
  const { data, error } = await validateBody(request, createMtbEventSchema);
  if (error) return error;

  try {
    // Generate unique slug for the event
    const baseSlug = generateEventSlug(data.name);

    // Get existing slugs for MTB discipline
    const existingEvents = await db
      .select({ slug: raceEvents.slug })
      .from(raceEvents)
      .where(eq(raceEvents.discipline, "mtb"));

    const existingSlugs = new Set(
      existingEvents.map((e) => e.slug).filter(Boolean) as string[]
    );
    const eventSlug = makeSlugUnique(baseSlug, existingSlugs);

    // Create the race event (parent container) with new discipline format
    const [newEvent] = await db
      .insert(raceEvents)
      .values({
        name: data.name,
        slug: eventSlug,
        date: data.date,
        discipline: data.discipline, // "mtb" from schema
        subDiscipline: data.subDiscipline || "xco", // Store sub-discipline separately
        country: data.country || null,
        sourceUrl: data.sourceUrl || null,
        sourceType: data.sourceType || "rockthesport",
      })
      .returning();

    // Parse selected categories
    const selectedCategories = new Set(data.categories);

    // Group entries by category
    const entriesByCategory = new Map<string, typeof data.entries>();
    for (const entry of data.entries) {
      // For PDF startlists with explicit gender field, use that
      // Otherwise fall back to mapCategory which infers from category string
      let ageCategory: string | null = null;
      let gender: string | null = null;

      const mapped = mapCategory(entry.category);
      if (mapped) {
        ageCategory = mapped.ageCategory;
        // Use explicit gender if available (from PDF startlists), otherwise use mapped gender
        gender = entry.gender === "W" ? "women" : entry.gender === "M" ? "men" : mapped.gender;
      } else if (entry.gender) {
        // Category mapping failed but we have explicit gender - try to extract age category
        const cat = entry.category.toUpperCase().trim();
        if (cat.includes("ELITE") || cat === "ÉLITE" || cat === "ÉLIT") {
          ageCategory = "elite";
        } else if (cat.includes("U23") || cat.includes("SUB23") || cat.includes("SUB-23")) {
          ageCategory = "u23";
        } else if (cat.includes("JUNIOR")) {
          ageCategory = "junior";
        }
        gender = entry.gender === "W" ? "women" : "men";
      }

      if (!ageCategory || !gender) continue;

      const key = `${ageCategory}_${gender}`;
      if (!selectedCategories.has(key)) continue;

      const existing = entriesByCategory.get(key) || [];
      existing.push(entry);
      entriesByCategory.set(key, existing);
    }

    // Create races and startlists for each selected category
    const createdRaces: Array<{
      id: string;
      name: string;
      category: string;
      riderCount: number;
    }> = [];

    for (const [categoryKey, categoryEntries] of entriesByCategory) {
      const [ageCategory, gender] = categoryKey.split("_");
      const mapping = {
        ageCategory: ageCategory as "elite" | "u23" | "junior",
        gender: gender as "men" | "women",
      };
      const displayName = getCategoryDisplayName(mapping);

      // Generate category slug
      const categorySlug = generateCategorySlug(ageCategory, gender);

      // Create the race for this category
      const raceName = `${data.name} - ${displayName}`;
      const [newRace] = await db
        .insert(races)
        .values({
          name: raceName,
          categorySlug, // Add category slug
          date: data.date,
          discipline: data.discipline, // "mtb" from schema
          raceType: data.subDiscipline || "xco",
          ageCategory,
          gender,
          country: data.country || null,
          raceEventId: newEvent.id,
          startlistUrl: data.sourceUrl || null,
          submittedBy: user.id,
          status: "active",
        })
        .returning();

      // Process riders and create startlist entries
      let ridersAdded = 0;

      for (const entry of categoryEntries) {
        const fullName = `${entry.firstName} ${entry.lastName}`.trim();
        const normalizedName = normalizeRiderName(fullName);

        if (!normalizedName) continue;

        // Find or create rider
        let [existingRider] = await db
          .select()
          .from(riders)
          .where(ilike(riders.name, normalizedName))
          .limit(1);

        if (!existingRider) {
          [existingRider] = await db
            .insert(riders)
            .values({
              name: normalizedName,
              nationality: entry.nationality || null,
            })
            .returning();
        } else if (entry.nationality && !existingRider.nationality) {
          // Update nationality if missing
          await db
            .update(riders)
            .set({ nationality: entry.nationality })
            .where(eq(riders.id, existingRider.id));
        }

        // Find or create team if provided
        let teamId: string | null = null;
        const teamName = entry.teamName || entry.clubName;
        if (teamName) {
          let [existingTeam] = await db
            .select()
            .from(teams)
            .where(ilike(teams.name, teamName))
            .limit(1);

          if (!existingTeam) {
            [existingTeam] = await db
              .insert(teams)
              .values({
                name: teamName,
                discipline: data.discipline,
              })
              .returning();
          }
          teamId = existingTeam.id;
        }

        // Add to startlist
        await db
          .insert(raceStartlist)
          .values({
            raceId: newRace.id,
            riderId: existingRider.id,
            teamId,
            bibNumber: entry.bibNumber || null,
            status: "confirmed",
          })
          .onConflictDoNothing();

        ridersAdded++;
      }

      createdRaces.push({
        id: newRace.id,
        name: raceName,
        category: displayName,
        riderCount: ridersAdded,
      });
    }

    return NextResponse.json({
      success: true,
      event: {
        id: newEvent.id,
        name: newEvent.name,
        date: newEvent.date,
      },
      // For redirect
      eventSlug: eventSlug,
      discipline: data.discipline,
      races: createdRaces,
      totalRaces: createdRaces.length,
      totalRiders: createdRaces.reduce((sum, r) => sum + r.riderCount, 0),
    }, { status: 201 });
  } catch (err) {
    console.error("Error creating MTB event:", err);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
