import { NextRequest, NextResponse } from "next/server";
import { db, raceEvents, races, riders, raceResults } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  parseCopaCatalanaPdfUrl,
  mapCopaCatalanaCategory,
  normalizeName,
  parseTime,
} from "@/lib/scraper/copa-catalana";
import { parseUciResultsPdfUrl } from "@/lib/scraper/pdf-results-parser";
import { scrapeResultsPageUrls } from "@/lib/scraper/scrape-results-page";
import { processRaceElo } from "@/lib/prediction/process-race-elo";
import { findOrCreateRider, findOrCreateTeam } from "@/lib/riders/find-or-create";

const importResultsSchema = z.object({
  pdfUrls: z.array(z.string().url()).min(1).optional(),
  resultsPageUrl: z.string().url().optional(),
}).refine((data) => data.pdfUrls || data.resultsPageUrl, {
  message: "Either pdfUrls or resultsPageUrl must be provided",
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
    const { pdfUrls, resultsPageUrl } = validation.data;
    const allParsedResults: Array<{
      ageCategory: string;
      gender: string;
      name: string;
      team: string;
      position: number;
      time: string;
      timeGapSeconds: number | null;
      timeSeconds: number | null;
      dnf: boolean;
      dns: boolean;
    }> = [];

    if (resultsPageUrl) {
      // UCI results page flow: discover PDFs from page, parse each with UCI parser
      console.log(`Discovering result PDFs from: ${resultsPageUrl}`);
      const discoveredPdfs = await scrapeResultsPageUrls(resultsPageUrl);

      if (discoveredPdfs.length === 0) {
        return NextResponse.json(
          { error: "No result PDFs found on the provided page" },
          { status: 400 }
        );
      }

      for (const pdf of discoveredPdfs) {
        console.log(`Parsing UCI PDF: ${pdf.filename} (${pdf.ageCategory}/${pdf.gender})`);
        const parsed = await parseUciResultsPdfUrl(pdf.pdfUrl);

        if (!parsed || parsed.results.length === 0) {
          console.log(`No results found in PDF: ${pdf.filename}`);
          continue;
        }

        for (const result of parsed.results) {
          const name = normalizeName(`${result.lastName} ${result.firstName}`);
          allParsedResults.push({
            ageCategory: pdf.ageCategory,
            gender: pdf.gender,
            name,
            team: result.team,
            position: result.position,
            time: "",
            timeGapSeconds: null,
            timeSeconds: result.timeSeconds,
            dnf: result.dnf,
            dns: result.dns,
          });
        }
      }
    } else if (pdfUrls) {
      // Direct PDF URLs flow: try UCI parser first, fall back to Copa Catalana
      for (const url of pdfUrls) {
        console.log(`Parsing PDF: ${url}`);

        // Try UCI parser first
        const uciParsed = await parseUciResultsPdfUrl(url);
        if (uciParsed && uciParsed.results.length > 0) {
          console.log(`Parsed as UCI format: ${uciParsed.results.length} results (${uciParsed.ageCategory}/${uciParsed.gender})`);
          for (const result of uciParsed.results) {
            const name = normalizeName(`${result.lastName} ${result.firstName}`);
            allParsedResults.push({
              ageCategory: uciParsed.ageCategory,
              gender: uciParsed.gender,
              name,
              team: result.team,
              position: result.position,
              time: "",
              timeGapSeconds: null,
              timeSeconds: result.timeSeconds,
              dnf: result.dnf,
              dns: result.dns,
            });
          }
          continue;
        }

        // Fall back to Copa Catalana parser
        const parsed = await parseCopaCatalanaPdfUrl(url);
        if (!parsed || parsed.results.length === 0) {
          console.log(`No results found in PDF: ${url}`);
          continue;
        }

        console.log(`Found ${parsed.results.length} results in PDF from categories: ${parsed.categories.join(", ")}`);
        for (const result of parsed.results) {
          const mapped = mapCopaCatalanaCategory(result.category);
          if (!mapped) continue;

          allParsedResults.push({
            ageCategory: mapped.ageCategory,
            gender: mapped.gender,
            name: normalizeName(result.name),
            team: result.team,
            position: result.position,
            time: result.time,
            timeGapSeconds: result.timeGapSeconds,
            timeSeconds: null,
            dnf: result.dnf,
            dns: result.dns,
          });
        }
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
        const riderBefore = await db.query.riders.findFirst({
          where: eq(riders.name, result.name),
        });

        const rider = await findOrCreateRider({ name: result.name });

        if (!riderBefore) {
          ridersCreated++;
        }

        // Find or create team
        let teamId: string | null = null;
        if (result.team) {
          const team = await findOrCreateTeam(result.team, "mtb");
          teamId = team.id;

          // Update rider's current team
          if (teamId && rider.teamId !== teamId) {
            await db
              .update(riders)
              .set({ teamId })
              .where(eq(riders.id, rider.id));
          }
        }

        // Insert result
        // UCI parser provides timeSeconds directly; Copa Catalana uses parseTime (ms)
        let timeSeconds = result.timeSeconds;
        if (timeSeconds == null && result.time) {
          const timeMs = parseTime(result.time);
          timeSeconds = timeMs ? Math.round(timeMs / 1000) : null;
        }
        await db.insert(raceResults).values({
          raceId: race.id,
          riderId: rider.id,
          teamId,
          position: result.position,
          timeSeconds,
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

    // Process ELO updates for imported races
    const eloResults: Array<{ raceId: string; updates: number | null }> = [];
    for (const s of summary) {
      try {
        const updates = await processRaceElo(s.raceId);
        eloResults.push({ raceId: s.raceId, updates });
      } catch (error) {
        console.error(`Error processing ELO for race ${s.raceId}:`, error);
        eloResults.push({ raceId: s.raceId, updates: null });
      }
    }

    return NextResponse.json({
      success: true,
      eventId: id,
      totalImported,
      racesUpdated: summary.length,
      eloUpdated: eloResults.filter((r) => r.updates !== null).length,
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
