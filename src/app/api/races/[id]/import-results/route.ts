import { NextRequest, NextResponse } from "next/server";
import { db, races, raceResults } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { processRaceElo } from "@/lib/prediction/process-race-elo";
import {
  parseCopaCatalanaPdfUrl,
  normalizeName,
  mapCopaCatalanaCategory,
  parseTime,
} from "@/lib/scraper/copa-catalana";
import { findOrCreateRider, findOrCreateTeam } from "@/lib/riders/find-or-create";

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

      const rider = await findOrCreateRider({ name: normalizedName });

      let teamId: string | null = null;
      if (result.team) {
        const team = await findOrCreateTeam(result.team, race.discipline);
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

    // Process ELO updates
    let eloUpdates: number | null = null;
    try {
      eloUpdates = await processRaceElo(raceId);
    } catch (error) {
      console.error(`Error processing ELO for race ${raceId}:`, error);
    }

    return NextResponse.json({
      success: true,
      eventName: parsed.eventName,
      resultsImported: processedResults.length,
      eloUpdated: eloUpdates !== null,
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
