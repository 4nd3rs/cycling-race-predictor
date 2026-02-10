import { NextRequest, NextResponse } from "next/server";
import { db, races, raceStartlist, riders, teams } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { detectSource } from "@/lib/scraper/source-detector";
import { scrapeRockthesportEvent, mapCategory } from "@/lib/scraper/rockthesport";
import { z } from "zod";

/**
 * Add Info from URL API
 *
 * Adds startlist or results data to an existing race from a URL.
 * Detects whether the URL contains startlist or results and processes accordingly.
 */

const addFromUrlSchema = z.object({
  url: z.string().url(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: raceId } = await context.params;
    const body = await request.json();
    const validation = addFromUrlSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { url } = validation.data;

    // Get the race
    const [race] = await db
      .select()
      .from(races)
      .where(eq(races.id, raceId))
      .limit(1);

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Detect source type
    const source = detectSource(url);

    if (source.sourceType === "unknown") {
      return NextResponse.json(
        { error: "Unsupported URL source" },
        { status: 400 }
      );
    }

    // Route to appropriate handler
    let result;
    switch (source.sourceType) {
      case "rockthesport":
        result = await addFromRockthesport(url, race);
        break;
      // TODO: Add other sources (PCS, Copa Catalana)
      default:
        return NextResponse.json(
          { error: `Source ${source.sourceType} not yet supported for adding to existing races` },
          { status: 501 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error adding from URL:", error);
    return NextResponse.json(
      { error: "Failed to add data from URL", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * Add startlist data from Rockthesport to existing race
 */
async function addFromRockthesport(
  url: string,
  race: typeof races.$inferSelect
) {
  // Scrape the event
  const scrapedEvent = await scrapeRockthesportEvent(url);

  if (!scrapedEvent) {
    throw new Error("Could not scrape event from URL");
  }

  // Determine if this is startlist or results based on URL pattern
  const isResults = url.includes("/results") || url.includes("/clasificacion");

  // Filter entries that match this race's category
  const matchingEntries = scrapedEvent.entries.filter((entry) => {
    const mapped = mapCategory(entry.category || "");
    if (!mapped) return false;
    return mapped.ageCategory === race.ageCategory && mapped.gender === race.gender;
  });

  console.log(`Found ${matchingEntries.length} entries matching ${race.ageCategory} ${race.gender}`);

  if (matchingEntries.length === 0) {
    return {
      success: false,
      message: `No entries found for ${race.ageCategory} ${race.gender} in the scraped data`,
      totalScraped: scrapedEvent.entries.length,
    };
  }

  // Get existing startlist to avoid duplicates
  const existingStartlist = await db
    .select({ riderId: raceStartlist.riderId })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, race.id));

  const existingRiderIds = new Set(existingStartlist.map((e) => e.riderId));

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const entry of matchingEntries) {
    const fullName = `${entry.firstName} ${entry.lastName}`.trim();

    // Find or create rider
    let [rider] = await db
      .select()
      .from(riders)
      .where(eq(riders.name, fullName))
      .limit(1);

    if (!rider) {
      // Create new rider
      const [newRider] = await db
        .insert(riders)
        .values({
          name: fullName,
          nationality: entry.nationality || null,
        })
        .returning();
      rider = newRider;
    }

    // Find or create team if provided
    let teamId: string | null = null;
    const teamName = entry.teamName || entry.clubName;
    if (teamName) {
      let [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.name, teamName))
        .limit(1);

      if (!team) {
        const [newTeam] = await db
          .insert(teams)
          .values({
            name: teamName,
            discipline: "mtb",
          })
          .returning();
        team = newTeam;
      }
      teamId = team.id;
    }

    // Check if already in startlist
    if (existingRiderIds.has(rider.id)) {
      // Update team if needed
      if (teamId) {
        await db
          .update(raceStartlist)
          .set({ teamId })
          .where(
            and(
              eq(raceStartlist.raceId, race.id),
              eq(raceStartlist.riderId, rider.id)
            )
          );
        updatedCount++;
      } else {
        skippedCount++;
      }
      continue;
    }

    // Add to startlist
    await db.insert(raceStartlist).values({
      raceId: race.id,
      riderId: rider.id,
      teamId,
      bibNumber: entry.bibNumber || null,
    });

    existingRiderIds.add(rider.id);
    addedCount++;
  }

  // Update race's startlist URL
  await db
    .update(races)
    .set({ startlistUrl: url })
    .where(eq(races.id, race.id));

  return {
    success: true,
    type: isResults ? "results" : "startlist",
    added: addedCount,
    updated: updatedCount,
    skipped: skippedCount,
    total: matchingEntries.length,
    message: `Added ${addedCount} new riders, updated ${updatedCount}, skipped ${skippedCount} existing`,
  };
}
