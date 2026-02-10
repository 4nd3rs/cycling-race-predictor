import { NextRequest, NextResponse } from "next/server";
import { db, races, raceResults, riders, teams } from "@/lib/db";
import { eq, ilike } from "drizzle-orm";
import {
  parseCopaCatalanaPdfUrl,
  normalizeName,
  parseTime,
  mapCopaCatalanaCategory,
} from "@/lib/scraper/copa-catalana";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: PageProps) {
  try {
    const { id: raceId } = await params;

    // Get the race
    const race = await db.query.races.findFirst({
      where: eq(races.id, raceId),
    });

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Get PDF URL from the race
    const pdfUrl = race.startlistUrl;
    if (!pdfUrl) {
      return NextResponse.json(
        { error: "No PDF URL found for this race" },
        { status: 400 }
      );
    }

    console.log(`Re-importing results for race ${raceId} from ${pdfUrl}`);

    // Parse the PDF
    const parsed = await parseCopaCatalanaPdfUrl(pdfUrl);
    if (!parsed || parsed.results.length === 0) {
      return NextResponse.json(
        { error: "Failed to parse PDF or no results found" },
        { status: 400 }
      );
    }

    // Delete existing results for this race
    await db.delete(raceResults).where(eq(raceResults.raceId, raceId));

    // Determine which category this race is
    const raceCategory = race.ageCategory || "elite";
    const raceGender = race.gender || "men";

    // Filter results for this race's category
    const categoryResults = parsed.results.filter((r) => {
      const mapped = mapCopaCatalanaCategory(r.category);
      if (!mapped) return false;
      return mapped.ageCategory === raceCategory && mapped.gender === raceGender;
    });

    console.log(`Found ${categoryResults.length} results for ${raceCategory} ${raceGender}`);

    // Import results
    let imported = 0;
    for (const result of categoryResults) {
      const normalizedName = normalizeName(result.name);

      // Find or create rider
      let rider = await db.query.riders.findFirst({
        where: ilike(riders.name, normalizedName),
      });

      if (!rider) {
        const simpleName = normalizedName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        rider = await db.query.riders.findFirst({
          where: ilike(riders.name, simpleName),
        });
      }

      if (!rider) {
        const [newRider] = await db
          .insert(riders)
          .values({ name: normalizedName })
          .returning();
        rider = newRider;
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
            .values({
              name: result.team,
              discipline: "mtb_xco",
            })
            .onConflictDoNothing();
          team = await db.query.teams.findFirst({
            where: ilike(teams.name, result.team),
          });
        }
        teamId = team?.id || null;

        // Update rider's team
        if (teamId && rider.teamId !== teamId) {
          await db
            .update(riders)
            .set({ teamId: teamId })
            .where(eq(riders.id, rider.id));
        }
      }

      // Insert result
      const timeMs = parseTime(result.time);
      await db.insert(raceResults).values({
        raceId: raceId,
        riderId: rider.id,
        teamId: teamId,
        position: result.position,
        timeSeconds: timeMs ? Math.round(timeMs / 1000) : null,
        dnf: result.dnf,
        dns: result.dns,
      });
      imported++;
    }

    return NextResponse.json({
      success: true,
      imported,
      categories: [{ ageCategory: raceCategory, gender: raceGender }],
    });
  } catch (error) {
    console.error("Error re-importing results:", error);
    return NextResponse.json(
      {
        error: "Failed to re-import results",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
