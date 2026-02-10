import { NextRequest, NextResponse } from "next/server";
import { db, races, riders, raceResults, raceStartlist, teams, raceEvents } from "@/lib/db";
import { eq, and, ilike } from "drizzle-orm";
import { z } from "zod";
import {
  parseCopaCatalanaPdfUrl,
  normalizeName,
  mapCopaCatalanaCategory,
  parseTime,
  type CopaCatalanaResult,
} from "@/lib/scraper/copa-catalana";

const importResultsSchema = z.object({
  pdfUrl: z.string().url(),
  createRaceIfMissing: z.boolean().optional().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: raceId } = await params;
    const body = await request.json();

    const validation = importResultsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { pdfUrl } = validation.data;

    // Check if race exists
    const race = await db.query.races.findFirst({
      where: eq(races.id, raceId),
    });

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Parse PDF
    console.log(`Parsing PDF: ${pdfUrl}`);
    const parsed = await parseCopaCatalanaPdfUrl(pdfUrl);

    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse PDF" },
        { status: 400 }
      );
    }

    console.log(`Parsed ${parsed.results.length} results from ${parsed.eventName}`);
    console.log(`Categories found: ${parsed.categories.join(", ")}`);

    // Filter results for the race's category
    const raceCategory = mapCopaCatalanaCategory(
      race.ageCategory === "u23" ? "Sub23" : race.ageCategory || "elite"
    );

    const relevantResults = parsed.results.filter((r) => {
      const cat = mapCopaCatalanaCategory(r.category);
      if (!cat || !raceCategory) return false;
      return cat.ageCategory === raceCategory.ageCategory;
    });

    console.log(`${relevantResults.length} results match race category (${race.ageCategory})`);

    // Process results
    const processedResults: Array<{
      riderId: string;
      riderName: string;
      position: number;
      time: number | null;
      dnf: boolean;
      dns: boolean;
    }> = [];

    for (const result of relevantResults) {
      const normalizedName = normalizeName(result.name);

      // Find or create rider
      let rider = await db.query.riders.findFirst({
        where: ilike(riders.name, normalizedName),
      });

      if (!rider) {
        // Try matching without accents
        const simpleName = normalizedName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        rider = await db.query.riders.findFirst({
          where: ilike(riders.name, simpleName),
        });
      }

      if (!rider) {
        // Create new rider
        const [newRider] = await db
          .insert(riders)
          .values({
            name: normalizedName,
            // Try to extract nationality from team or other info
          })
          .returning();
        rider = newRider;
        console.log(`Created new rider: ${normalizedName}`);
      }

      // Find or create team
      let teamId: string | null = null;
      if (result.team) {
        let team = await db.query.teams.findFirst({
          where: ilike(teams.name, result.team),
        });

        if (!team) {
          const [newTeam] = await db
            .insert(teams)
            .values({
              name: result.team,
              discipline: race.discipline,
            })
            .returning();
          team = newTeam;
          console.log(`Created new team: ${result.team}`);
        }

        teamId = team.id;
      }

      processedResults.push({
        riderId: rider.id,
        riderName: normalizedName,
        position: result.position,
        time: parseTime(result.time),
        dnf: result.dnf,
        dns: result.dns,
      });
    }

    // Check for existing results
    const existingResults = await db.query.raceResults.findMany({
      where: eq(raceResults.raceId, raceId),
    });

    if (existingResults.length > 0) {
      // Delete existing results to replace
      await db.delete(raceResults).where(eq(raceResults.raceId, raceId));
      console.log(`Deleted ${existingResults.length} existing results`);
    }

    // Insert new results
    if (processedResults.length > 0) {
      await db.insert(raceResults).values(
        processedResults.map((r) => ({
          raceId,
          riderId: r.riderId,
          position: r.position,
          timeMs: r.time,
          dnf: r.dnf,
          dns: r.dns,
        }))
      );
    }

    // Update race status to completed
    await db
      .update(races)
      .set({ status: "completed" })
      .where(eq(races.id, raceId));

    return NextResponse.json({
      success: true,
      eventName: parsed.eventName,
      resultsImported: processedResults.length,
      ridersCreated: processedResults.filter((r) => true).length, // Could track this better
      results: processedResults.slice(0, 10).map((r) => ({
        position: r.position,
        name: r.riderName,
        dnf: r.dnf,
        dns: r.dns,
      })),
    });
  } catch (error) {
    console.error("Error importing results:", error);
    return NextResponse.json(
      { error: "Failed to import results" },
      { status: 500 }
    );
  }
}

// GET endpoint to preview results without importing
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pdfUrl = searchParams.get("pdfUrl");

  if (!pdfUrl) {
    return NextResponse.json(
      { error: "pdfUrl query parameter required" },
      { status: 400 }
    );
  }

  try {
    const parsed = await parseCopaCatalanaPdfUrl(pdfUrl);

    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse PDF" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      eventName: parsed.eventName,
      seriesName: parsed.seriesName,
      date: parsed.date,
      location: parsed.location,
      categories: parsed.categories,
      totalResults: parsed.results.length,
      preview: parsed.results.slice(0, 20).map((r) => ({
        position: r.position,
        name: normalizeName(r.name),
        category: r.category,
        team: r.team,
        time: r.time,
        dnf: r.dnf,
        dns: r.dns,
      })),
    });
  } catch (error) {
    console.error("Error previewing results:", error);
    return NextResponse.json(
      { error: "Failed to preview results" },
      { status: 500 }
    );
  }
}
