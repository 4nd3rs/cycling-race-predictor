import { NextRequest, NextResponse } from "next/server";
import { db, raceEvents, races, riders, raceResults, teams } from "@/lib/db";
import { eq, ilike } from "drizzle-orm";
import { z } from "zod";
import {
  parseCopaCatalanaPdfUrl,
  mapCopaCatalanaCategory,
  normalizeName,
  parseTime,
} from "@/lib/scraper/copa-catalana";

const importResultsSchema = z.object({
  pdfUrls: z.array(z.string().url()).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const validation = importResultsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Verify event exists
    const event = await db.query.raceEvents.findFirst({
      where: eq(raceEvents.id, id),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Get all races for this event
    const eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, id));

    if (eventRaces.length === 0) {
      return NextResponse.json(
        { error: "No races found for this event" },
        { status: 400 }
      );
    }

    // Build a lookup: "ageCategory:gender" -> race
    const raceLookup = new Map<string, (typeof eventRaces)[number]>();
    for (const race of eventRaces) {
      const key = `${race.ageCategory}:${race.gender}`;
      raceLookup.set(key, race);
    }

    // Parse all PDFs
    const { pdfUrls } = validation.data;
    const allParsedResults: Array<{
      ageCategory: string;
      gender: string;
      name: string;
      team: string;
      position: number;
      time: string;
      timeGapSeconds: number | null;
      dnf: boolean;
      dns: boolean;
    }> = [];

    for (const url of pdfUrls) {
      console.log(`Parsing PDF: ${url}`);
      const parsed = await parseCopaCatalanaPdfUrl(url);

      if (!parsed || parsed.results.length === 0) {
        console.log(`No results found in PDF: ${url}`);
        continue;
      }

      console.log(`Found ${parsed.results.length} results in PDF from categories: ${parsed.categories.join(", ")}`);

      for (const result of parsed.results) {
        const mapped = mapCopaCatalanaCategory(result.category);
        if (!mapped) {
          // Skip unmapped categories (master, cadet, etc.)
          continue;
        }

        allParsedResults.push({
          ageCategory: mapped.ageCategory,
          gender: mapped.gender,
          name: normalizeName(result.name),
          team: result.team,
          position: result.position,
          time: result.time,
          timeGapSeconds: result.timeGapSeconds,
          dnf: result.dnf,
          dns: result.dns,
        });
      }
    }

    if (allParsedResults.length === 0) {
      return NextResponse.json(
        { error: "No results could be parsed from the provided PDFs" },
        { status: 400 }
      );
    }

    // Group results by category
    const resultsByCategory = new Map<string, typeof allParsedResults>();
    for (const result of allParsedResults) {
      const key = `${result.ageCategory}:${result.gender}`;
      if (!resultsByCategory.has(key)) {
        resultsByCategory.set(key, []);
      }
      resultsByCategory.get(key)!.push(result);
    }

    // Import results for each matched category
    const summary: Array<{
      raceId: string;
      raceName: string;
      category: string;
      imported: number;
      ridersCreated: number;
      teamsCreated: number;
    }> = [];

    for (const [categoryKey, categoryResults] of resultsByCategory) {
      const race = raceLookup.get(categoryKey);
      if (!race) {
        console.log(`No matching race for category ${categoryKey}, skipping ${categoryResults.length} results`);
        continue;
      }

      console.log(`Importing ${categoryResults.length} results for ${race.name}`);

      // Delete existing results for this race (idempotent reimport)
      await db.delete(raceResults).where(eq(raceResults.raceId, race.id));

      let ridersCreated = 0;
      let teamsCreated = 0;

      for (const result of categoryResults) {
        // Find rider by name (case-insensitive)
        let rider = await db.query.riders.findFirst({
          where: ilike(riders.name, result.name),
        });

        // Fallback: try accent-stripped name
        if (!rider) {
          const strippedName = result.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          rider = await db.query.riders.findFirst({
            where: ilike(riders.name, strippedName),
          });
        }

        // Create rider if not found
        if (!rider) {
          const [newRider] = await db
            .insert(riders)
            .values({ name: result.name })
            .returning();
          rider = newRider;
          ridersCreated++;
        }

        // Find or create team
        let teamId: string | null = null;
        if (result.team) {
          let team = await db.query.teams.findFirst({
            where: ilike(teams.name, result.team),
          });

          if (!team) {
            await db
              .insert(teams)
              .values({ name: result.team, discipline: "mtb_xco" })
              .onConflictDoNothing();
            team = await db.query.teams.findFirst({
              where: ilike(teams.name, result.team),
            });
            if (team) teamsCreated++;
          }
          teamId = team?.id || null;

          // Update rider's current team
          if (teamId && rider.teamId !== teamId) {
            await db
              .update(riders)
              .set({ teamId })
              .where(eq(riders.id, rider.id));
          }
        }

        // Insert result
        const timeMs = parseTime(result.time);
        await db.insert(raceResults).values({
          raceId: race.id,
          riderId: rider.id,
          teamId,
          position: result.position,
          timeSeconds: timeMs ? Math.round(timeMs / 1000) : null,
          timeGapSeconds: result.timeGapSeconds,
          dnf: result.dnf,
          dns: result.dns,
        });
      }

      // Mark race as completed
      await db
        .update(races)
        .set({ status: "completed" })
        .where(eq(races.id, race.id));

      summary.push({
        raceId: race.id,
        raceName: race.name,
        category: categoryKey,
        imported: categoryResults.length,
        ridersCreated,
        teamsCreated,
      });
    }

    const totalImported = summary.reduce((sum, s) => sum + s.imported, 0);

    return NextResponse.json({
      success: true,
      eventId: id,
      totalImported,
      racesUpdated: summary.length,
      summary,
    });
  } catch (error) {
    console.error("Error importing results:", error);
    return NextResponse.json(
      {
        error: "Failed to import results",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
