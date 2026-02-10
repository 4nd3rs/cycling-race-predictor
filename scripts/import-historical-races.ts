/**
 * Import Historical Races from XCOdata
 *
 * This script fetches historical race results from xcodata.com and imports them
 * into the database to populate Elo ratings for predictions.
 *
 * Usage: npx tsx scripts/import-historical-races.ts [year] [maxRaces]
 * Example: npx tsx scripts/import-historical-races.ts 2025 50
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, ilike, and, desc } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  scrapeXCOdataRacesList,
  scrapeXCOdataRaceResults,
  type XCOdataRaceResults,
} from "../src/lib/scraper/xcodata-races";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "../src/lib/url-utils";

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Map XCOdata race class to UCI category
function mapRaceClass(raceClass: string): string {
  const mapping: Record<string, string> = {
    WC: "World Cup",
    WCH: "World Championships",
    HC: "HC",
    C1: "C1",
    C2: "C2",
    C3: "C3",
    CS: "Continental Series",
    NC: "National Championships",
    CC: "Continental Championships",
    JO: "Junior Olympics",
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
  // Expected position based on Elo (simplified)
  const expectedPosition = Math.max(1, Math.round(totalRiders / 2));

  // Performance vs expectation
  const performanceRatio = (expectedPosition - position) / totalRiders;

  // K-factor: higher for top-tier races, decays with more races
  const kFactor = 32;

  // Elo change scales with performance
  return Math.round(kFactor * performanceRatio);
}

// Normalize rider name for matching
function normalizeRiderName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^A-Z\s-]/g, "") // Keep only letters, spaces, hyphens
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

async function importRaceResults(raceData: XCOdataRaceResults): Promise<{
  eventsCreated: number;
  racesCreated: number;
  resultsCreated: number;
  ridersCreated: number;
}> {
  const stats = {
    eventsCreated: 0,
    racesCreated: 0,
    resultsCreated: 0,
    ridersCreated: 0,
  };

  const { race, categories } = raceData;

  if (categories.length === 0) {
    console.log(`  No results for ${race.name}, skipping`);
    return stats;
  }

  // Generate unique event slug
  const baseSlug = generateEventSlug(race.name);
  const existingEvents = await db
    .select({ slug: schema.raceEvents.slug })
    .from(schema.raceEvents)
    .where(eq(schema.raceEvents.discipline, "mtb"));

  const existingSlugs = new Set(
    existingEvents.map((e) => e.slug).filter(Boolean) as string[]
  );
  const eventSlug = makeSlugUnique(baseSlug, existingSlugs);

  // Check if event already exists (by name and date)
  const [existingEvent] = await db
    .select()
    .from(schema.raceEvents)
    .where(
      and(
        ilike(schema.raceEvents.name, race.name),
        eq(schema.raceEvents.date, race.date)
      )
    )
    .limit(1);

  let eventId: string;

  if (existingEvent) {
    eventId = existingEvent.id;
    console.log(`  Event already exists: ${race.name}`);
  } else {
    // Create the race event
    const [newEvent] = await db
      .insert(schema.raceEvents)
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
    console.log(`  Created event: ${race.name} (${eventSlug})`);
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
      .from(schema.races)
      .where(
        and(
          eq(schema.races.raceEventId, eventId),
          eq(schema.races.ageCategory, ageCategory),
          eq(schema.races.gender, gender)
        )
      )
      .limit(1);

    let raceId: string;

    if (existingRace) {
      raceId = existingRace.id;
      console.log(`    Race already exists: ${raceName}`);
    } else {
      // Create the race
      const [newRace] = await db
        .insert(schema.races)
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
      console.log(`    Created race: ${raceName}`);
    }

    // Process results
    for (const result of results) {
      const normalizedName = normalizeRiderName(result.riderName);

      // Find or create rider
      let [rider] = await db
        .select()
        .from(schema.riders)
        .where(eq(schema.riders.xcoId, result.xcoRiderId))
        .limit(1);

      if (!rider) {
        // Try by name
        [rider] = await db
          .select()
          .from(schema.riders)
          .where(ilike(schema.riders.name, normalizedName))
          .limit(1);
      }

      if (!rider) {
        // Create new rider
        [rider] = await db
          .insert(schema.riders)
          .values({
            name: normalizedName,
            xcoId: result.xcoRiderId,
            nationality: result.nationality || null,
          })
          .returning();
        stats.ridersCreated++;
      } else {
        // Update XCO ID and nationality if missing
        const updates: Partial<schema.Rider> = {};
        if (result.xcoRiderId && !rider.xcoId) {
          updates.xcoId = result.xcoRiderId;
        }
        if (result.nationality && !rider.nationality) {
          updates.nationality = result.nationality;
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(schema.riders)
            .set(updates)
            .where(eq(schema.riders.id, rider.id));
        }
      }

      // Check if result already exists
      const [existingResult] = await db
        .select()
        .from(schema.raceResults)
        .where(
          and(
            eq(schema.raceResults.raceId, raceId),
            eq(schema.raceResults.riderId, rider.id)
          )
        )
        .limit(1);

      if (!existingResult) {
        // Create result
        await db.insert(schema.raceResults).values({
          raceId,
          riderId: rider.id,
          position: result.position,
          timeSeconds: parseTimeToSeconds(result.time),
          pointsUci: result.uciPoints || null,
        });
        stats.resultsCreated++;
      }

      // Update rider Elo based on result
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
  // Get or create discipline stats
  let [stats] = await db
    .select()
    .from(schema.riderDisciplineStats)
    .where(
      and(
        eq(schema.riderDisciplineStats.riderId, riderId),
        eq(schema.riderDisciplineStats.discipline, discipline),
        eq(schema.riderDisciplineStats.ageCategory, ageCategory)
      )
    )
    .limit(1);

  const currentElo = stats ? parseFloat(stats.currentElo || "1500") : 1500;

  // Calculate Elo change (weighted by race class)
  const classMultiplier: Record<string, number> = {
    WC: 1.5,
    WCH: 2.0,
    HC: 1.2,
    C1: 1.0,
    C2: 0.8,
    CS: 0.9,
    NC: 0.7,
  };
  const multiplier = classMultiplier[raceClass] || 1.0;

  const eloChange = calculateEloChange(position, totalRiders, currentElo) * multiplier;
  const newElo = Math.round(currentElo + eloChange);

  // Clamp Elo between 1000 and 2500
  const clampedElo = Math.min(2500, Math.max(1000, newElo));

  if (!stats) {
    // Create new stats
    await db.insert(schema.riderDisciplineStats).values({
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
    // Update existing stats
    const newRacesTotal = (stats.racesTotal || 0) + 1;
    const newWinsTotal = (stats.winsTotal || 0) + (position === 1 ? 1 : 0);
    const newPodiumsTotal = (stats.podiumsTotal || 0) + (position <= 3 ? 1 : 0);

    // Calculate running mean
    const currentMean = parseFloat(stats.eloMean || "1500");
    const newMean = currentMean + (clampedElo - currentMean) / newRacesTotal;

    // Reduce variance with more races
    const currentVariance = parseFloat(stats.eloVariance || "350");
    const newVariance = Math.max(50, currentVariance * 0.95);

    await db
      .update(schema.riderDisciplineStats)
      .set({
        currentElo: String(clampedElo),
        eloMean: String(Math.round(newMean)),
        eloVariance: String(Math.round(newVariance)),
        racesTotal: newRacesTotal,
        winsTotal: newWinsTotal,
        podiumsTotal: newPodiumsTotal,
        updatedAt: new Date(),
      })
      .where(eq(schema.riderDisciplineStats.id, stats.id));
  }

  // Record Elo history
  await db.insert(schema.eloHistory).values({
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

async function main() {
  const args = process.argv.slice(2);
  const year = parseInt(args[0] || "2025", 10);
  const maxRaces = parseInt(args[1] || "30", 10);
  const raceClasses = args[2]?.split(",") || ["WC", "HC", "C1"];

  console.log(`\n=== Importing ${year} XCO Race Results ===`);
  console.log(`Max races: ${maxRaces}`);
  console.log(`Race classes: ${raceClasses.join(", ")}`);
  console.log("");

  // Fetch races list
  console.log("Fetching races list from XCOdata...");
  const races = await scrapeXCOdataRacesList(year, raceClasses);

  if (races.length === 0) {
    console.log("No races found!");
    return;
  }

  console.log(`Found ${races.length} races, processing up to ${maxRaces}...\n`);

  // Sort by date (oldest first for chronological Elo updates)
  races.sort((a, b) => a.date.localeCompare(b.date));

  const totals = {
    eventsCreated: 0,
    racesCreated: 0,
    resultsCreated: 0,
    ridersCreated: 0,
    processed: 0,
    failed: 0,
  };

  for (const race of races.slice(0, maxRaces)) {
    console.log(`\nProcessing: ${race.name} (${race.date})`);

    try {
      const raceResults = await scrapeXCOdataRaceResults(race.id);

      if (raceResults) {
        const stats = await importRaceResults(raceResults);
        totals.eventsCreated += stats.eventsCreated;
        totals.racesCreated += stats.racesCreated;
        totals.resultsCreated += stats.resultsCreated;
        totals.ridersCreated += stats.ridersCreated;
        totals.processed++;
      } else {
        console.log(`  Could not fetch results`);
        totals.failed++;
      }
    } catch (error) {
      console.error(`  Error: ${error}`);
      totals.failed++;
    }
  }

  console.log("\n=== Import Complete ===");
  console.log(`Races processed: ${totals.processed}`);
  console.log(`Races failed: ${totals.failed}`);
  console.log(`Events created: ${totals.eventsCreated}`);
  console.log(`Races created: ${totals.racesCreated}`);
  console.log(`Results created: ${totals.resultsCreated}`);
  console.log(`Riders created: ${totals.ridersCreated}`);
}

main().catch(console.error);
