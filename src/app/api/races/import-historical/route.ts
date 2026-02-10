import { NextResponse } from "next/server";
import {
  db,
  raceEvents,
  races,
  riders,
  raceResults,
  riderDisciplineStats,
  eloHistory,
} from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { eq, ilike, and } from "drizzle-orm";
import {
  scrapeXCOdataRacesList,
  scrapeXCOdataRaceResults,
  type XCOdataRaceResults,
} from "@/lib/scraper/xcodata-races";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "@/lib/url-utils";

// Map XCOdata race class to UCI category
function mapRaceClass(raceClass: string): string {
  const mapping: Record<string, string> = {
    WC: "World Cup",
    WCH: "World Championships",
    HC: "HC",
    C1: "C1",
    C2: "C2",
    CS: "Continental Series",
  };
  return mapping[raceClass] || raceClass;
}

// Parse time string to seconds
function parseTimeToSeconds(time: string | null): number | null {
  if (!time) return null;
  const parts = time.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

// Calculate Elo change based on race result
function calculateEloChange(
  position: number,
  totalRiders: number,
  currentElo: number
): number {
  const expectedPosition = Math.max(1, Math.round(totalRiders / 2));
  const performanceRatio = (expectedPosition - position) / totalRiders;
  const kFactor = 32;
  return Math.round(kFactor * performanceRatio);
}

// Normalize rider name
function normalizeRiderName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function importRaceResults(raceData: XCOdataRaceResults) {
  const stats = {
    eventsCreated: 0,
    racesCreated: 0,
    resultsCreated: 0,
    ridersCreated: 0,
  };

  const { race, categories } = raceData;
  if (categories.length === 0) return stats;

  // Generate unique event slug
  const baseSlug = generateEventSlug(race.name);
  const existingEvents = await db
    .select({ slug: raceEvents.slug })
    .from(raceEvents)
    .where(eq(raceEvents.discipline, "mtb"));

  const existingSlugs = new Set(
    existingEvents.map((e) => e.slug).filter(Boolean) as string[]
  );
  const eventSlug = makeSlugUnique(baseSlug, existingSlugs);

  // Check if event already exists
  const [existingEvent] = await db
    .select()
    .from(raceEvents)
    .where(
      and(
        ilike(raceEvents.name, race.name),
        eq(raceEvents.date, race.date)
      )
    )
    .limit(1);

  let eventId: string;

  if (existingEvent) {
    eventId = existingEvent.id;
  } else {
    const [newEvent] = await db
      .insert(raceEvents)
      .values({
        name: race.name,
        slug: eventSlug,
        date: race.date,
        discipline: "mtb",
        subDiscipline: "xco",
        country: race.country || null,
        sourceUrl: race.url,
        sourceType: "xcodata",
      })
      .returning();

    eventId = newEvent.id;
    stats.eventsCreated++;
  }

  // Process each category
  for (const category of categories) {
    const { ageCategory, gender, results } = category;
    if (results.length === 0) continue;

    const categorySlug = generateCategorySlug(ageCategory, gender);
    const raceName = `${race.name} - ${ageCategory.charAt(0).toUpperCase() + ageCategory.slice(1)} ${gender.charAt(0).toUpperCase() + gender.slice(1)}`;

    // Check if race already exists
    const [existingRace] = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.raceEventId, eventId),
          eq(races.ageCategory, ageCategory),
          eq(races.gender, gender)
        )
      )
      .limit(1);

    let raceId: string;

    if (existingRace) {
      raceId = existingRace.id;
    } else {
      const [newRace] = await db
        .insert(races)
        .values({
          name: raceName,
          categorySlug,
          date: race.date,
          discipline: "mtb",
          raceType: "xco",
          ageCategory,
          gender,
          country: race.country || null,
          uciCategory: mapRaceClass(race.raceClass),
          raceEventId: eventId,
          status: "completed",
        })
        .returning();

      raceId = newRace.id;
      stats.racesCreated++;
    }

    // Process results
    for (const result of results) {
      const normalizedName = normalizeRiderName(result.riderName);

      // Find or create rider
      let [rider] = await db
        .select()
        .from(riders)
        .where(eq(riders.xcoId, result.xcoRiderId))
        .limit(1);

      if (!rider) {
        [rider] = await db
          .select()
          .from(riders)
          .where(ilike(riders.name, normalizedName))
          .limit(1);
      }

      if (!rider) {
        [rider] = await db
          .insert(riders)
          .values({
            name: normalizedName,
            xcoId: result.xcoRiderId,
            nationality: result.nationality || null,
          })
          .returning();
        stats.ridersCreated++;
      } else {
        const updates: { xcoId?: string; nationality?: string } = {};
        if (result.xcoRiderId && !rider.xcoId) {
          updates.xcoId = result.xcoRiderId;
        }
        if (result.nationality && !rider.nationality) {
          updates.nationality = result.nationality;
        }
        if (Object.keys(updates).length > 0) {
          await db.update(riders).set(updates).where(eq(riders.id, rider.id));
        }
      }

      // Check if result already exists
      const [existingResult] = await db
        .select()
        .from(raceResults)
        .where(
          and(
            eq(raceResults.raceId, raceId),
            eq(raceResults.riderId, rider.id)
          )
        )
        .limit(1);

      if (!existingResult) {
        await db.insert(raceResults).values({
          raceId,
          riderId: rider.id,
          position: result.position,
          timeSeconds: parseTimeToSeconds(result.time),
          pointsUci: result.uciPoints || null,
        });
        stats.resultsCreated++;

        // Update rider Elo
        await updateRiderElo(
          rider.id,
          "mtb",
          ageCategory,
          result.position,
          results.length,
          raceId,
          race.raceClass
        );
      }
    }
  }

  return stats;
}

async function updateRiderElo(
  riderId: string,
  discipline: string,
  ageCategory: string,
  position: number,
  totalRiders: number,
  raceId: string,
  raceClass: string
): Promise<void> {
  let [stats] = await db
    .select()
    .from(riderDisciplineStats)
    .where(
      and(
        eq(riderDisciplineStats.riderId, riderId),
        eq(riderDisciplineStats.discipline, discipline),
        eq(riderDisciplineStats.ageCategory, ageCategory)
      )
    )
    .limit(1);

  const currentElo = stats ? parseFloat(stats.currentElo || "1500") : 1500;

  const classMultiplier: Record<string, number> = {
    WC: 1.5,
    WCH: 2.0,
    HC: 1.2,
    C1: 1.0,
    C2: 0.8,
    CS: 0.9,
  };
  const multiplier = classMultiplier[raceClass] || 1.0;

  const eloChange = calculateEloChange(position, totalRiders, currentElo) * multiplier;
  const newElo = Math.round(currentElo + eloChange);
  const clampedElo = Math.min(2500, Math.max(1000, newElo));

  if (!stats) {
    await db.insert(riderDisciplineStats).values({
      riderId,
      discipline,
      ageCategory,
      currentElo: String(clampedElo),
      eloMean: String(clampedElo),
      eloVariance: position <= 10 ? "150" : position <= 30 ? "200" : "300",
      racesTotal: 1,
      winsTotal: position === 1 ? 1 : 0,
      podiumsTotal: position <= 3 ? 1 : 0,
    });
  } else {
    const newRacesTotal = (stats.racesTotal || 0) + 1;
    const newWinsTotal = (stats.winsTotal || 0) + (position === 1 ? 1 : 0);
    const newPodiumsTotal = (stats.podiumsTotal || 0) + (position <= 3 ? 1 : 0);

    const currentMean = parseFloat(stats.eloMean || "1500");
    const newMean = currentMean + (clampedElo - currentMean) / newRacesTotal;

    const currentVariance = parseFloat(stats.eloVariance || "350");
    const newVariance = Math.max(50, currentVariance * 0.95);

    await db
      .update(riderDisciplineStats)
      .set({
        currentElo: String(clampedElo),
        eloMean: String(Math.round(newMean)),
        eloVariance: String(Math.round(newVariance)),
        racesTotal: newRacesTotal,
        winsTotal: newWinsTotal,
        podiumsTotal: newPodiumsTotal,
        updatedAt: new Date(),
      })
      .where(eq(riderDisciplineStats.id, stats.id));
  }

  await db.insert(eloHistory).values({
    riderId,
    raceId,
    discipline,
    ageCategory,
    eloBefore: String(currentElo),
    eloAfter: String(clampedElo),
    eloChange: String(eloChange),
    racePosition: position,
  });
}

export async function POST(request: Request) {
  // Rate limit (very strict for scraping)
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const year = body.year || 2025;
    const maxRaces = Math.min(body.maxRaces || 10, 50); // Cap at 50 for API
    const raceClasses = body.raceClasses || ["WC", "HC", "C1"];

    // Fetch races list
    const racesList = await scrapeXCOdataRacesList(year, raceClasses);

    if (racesList.length === 0) {
      return NextResponse.json(
        { error: "No races found for the specified criteria" },
        { status: 404 }
      );
    }

    // Sort by date (oldest first)
    racesList.sort((a, b) => a.date.localeCompare(b.date));

    const totals = {
      eventsCreated: 0,
      racesCreated: 0,
      resultsCreated: 0,
      ridersCreated: 0,
      processed: 0,
      failed: 0,
    };

    const processedRaces: string[] = [];

    for (const race of racesList.slice(0, maxRaces)) {
      try {
        const raceResults = await scrapeXCOdataRaceResults(race.id);

        if (raceResults) {
          const stats = await importRaceResults(raceResults);
          totals.eventsCreated += stats.eventsCreated;
          totals.racesCreated += stats.racesCreated;
          totals.resultsCreated += stats.resultsCreated;
          totals.ridersCreated += stats.ridersCreated;
          totals.processed++;
          processedRaces.push(race.name);
        } else {
          totals.failed++;
        }
      } catch (error) {
        console.error(`Error processing ${race.name}:`, error);
        totals.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      year,
      totalRacesFound: racesList.length,
      ...totals,
      processedRaces,
    });
  } catch (error) {
    console.error("Error importing historical races:", error);
    return NextResponse.json(
      { error: "Failed to import historical races" },
      { status: 500 }
    );
  }
}
