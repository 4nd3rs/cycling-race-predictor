/**
 * Migration Script: Backfill slugs and consolidate disciplines
 *
 * This script:
 * 1. Generates slugs for all existing race_events
 * 2. Generates category_slug for all existing races
 * 3. Auto-creates raceEvents for standalone races (races without raceEventId)
 * 4. Handles discipline consolidation (mtb_xco -> mtb + subDiscipline=xco)
 *
 * Run with: npx tsx scripts/migrate-slugs.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull, and, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
  convertLegacyDiscipline,
} from "../src/lib/url-utils";
import { config } from "dotenv";

// Load .env.local for local development
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient, { schema });

async function migrateRaceEvents() {
  console.log("\n=== Migrating Race Events ===\n");

  // Get all race events
  const events = await db.select().from(schema.raceEvents);
  console.log(`Found ${events.length} race events to process`);

  // Track existing slugs per discipline to ensure uniqueness
  const slugsByDiscipline = new Map<string, Set<string>>();

  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    // Convert legacy discipline format
    const { discipline: newDiscipline, subDiscipline } = convertLegacyDiscipline(
      event.discipline
    );

    // Initialize slug set for this discipline if needed
    if (!slugsByDiscipline.has(newDiscipline)) {
      slugsByDiscipline.set(newDiscipline, new Set());
    }
    const existingSlugs = slugsByDiscipline.get(newDiscipline)!;

    // If event already has a slug, just track it and update discipline if needed
    if (event.slug) {
      existingSlugs.add(event.slug);

      // Still need to update discipline/subDiscipline if it changed
      if (event.discipline !== newDiscipline) {
        await db
          .update(schema.raceEvents)
          .set({
            discipline: newDiscipline,
            subDiscipline: subDiscipline,
          })
          .where(eq(schema.raceEvents.id, event.id));
        console.log(`  Updated discipline for "${event.name}": ${event.discipline} -> ${newDiscipline}/${subDiscipline}`);
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    // Generate new slug
    const baseSlug = generateEventSlug(event.name);
    const uniqueSlug = makeSlugUnique(baseSlug, existingSlugs);
    existingSlugs.add(uniqueSlug);

    // Update the event
    await db
      .update(schema.raceEvents)
      .set({
        slug: uniqueSlug,
        discipline: newDiscipline,
        subDiscipline: subDiscipline,
      })
      .where(eq(schema.raceEvents.id, event.id));

    console.log(`  "${event.name}" -> slug: "${uniqueSlug}", discipline: ${newDiscipline}/${subDiscipline || "null"}`);
    updated++;
  }

  console.log(`\nRace Events: ${updated} updated, ${skipped} skipped`);
}

async function migrateRaces() {
  console.log("\n=== Migrating Races ===\n");

  // Get all races
  const allRaces = await db.select().from(schema.races);
  console.log(`Found ${allRaces.length} races to process`);

  let updated = 0;
  let skipped = 0;

  for (const race of allRaces) {
    // Convert legacy discipline format
    const { discipline: newDiscipline } = convertLegacyDiscipline(race.discipline);

    // Generate category slug if needed
    const categorySlug =
      race.categorySlug ||
      (race.ageCategory && race.gender
        ? generateCategorySlug(race.ageCategory, race.gender)
        : null);

    // Check if anything needs to be updated
    const needsUpdate =
      !race.categorySlug ||
      race.discipline !== newDiscipline;

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    // Update the race
    await db
      .update(schema.races)
      .set({
        categorySlug: categorySlug,
        discipline: newDiscipline,
      })
      .where(eq(schema.races.id, race.id));

    console.log(`  "${race.name}" -> categorySlug: "${categorySlug}", discipline: ${newDiscipline}`);
    updated++;
  }

  console.log(`\nRaces: ${updated} updated, ${skipped} skipped`);
}

async function createEventsForStandaloneRaces() {
  console.log("\n=== Creating Events for Standalone Races ===\n");

  // Get all races without a raceEventId
  const standaloneRaces = await db
    .select()
    .from(schema.races)
    .where(isNull(schema.races.raceEventId));

  console.log(`Found ${standaloneRaces.length} standalone races`);

  if (standaloneRaces.length === 0) {
    console.log("No standalone races to process");
    return;
  }

  // Track existing slugs per discipline to ensure uniqueness
  const existingEvents = await db.select().from(schema.raceEvents);
  const slugsByDiscipline = new Map<string, Set<string>>();

  for (const event of existingEvents) {
    if (!event.slug) continue;
    if (!slugsByDiscipline.has(event.discipline)) {
      slugsByDiscipline.set(event.discipline, new Set());
    }
    slugsByDiscipline.get(event.discipline)!.add(event.slug);
  }

  let created = 0;

  for (const race of standaloneRaces) {
    // Get the current (already converted) discipline
    const discipline = race.discipline;

    // Initialize slug set for this discipline if needed
    if (!slugsByDiscipline.has(discipline)) {
      slugsByDiscipline.set(discipline, new Set());
    }
    const existingSlugs = slugsByDiscipline.get(discipline)!;

    // Generate slug for the new event
    const baseSlug = generateEventSlug(race.name);
    const uniqueSlug = makeSlugUnique(baseSlug, existingSlugs);
    existingSlugs.add(uniqueSlug);

    // Determine subDiscipline from race type if MTB
    let subDiscipline: string | null = null;
    if (discipline === "mtb" && race.raceType) {
      const rtLower = race.raceType.toLowerCase();
      if (rtLower === "xco" || rtLower === "xcc" || rtLower === "xce" || rtLower === "xcm") {
        subDiscipline = rtLower;
      }
    }

    // Create the event
    const [newEvent] = await db
      .insert(schema.raceEvents)
      .values({
        name: race.name,
        slug: uniqueSlug,
        date: race.date,
        endDate: race.endDate,
        discipline: discipline,
        subDiscipline: subDiscipline,
        country: race.country,
        sourceUrl: race.startlistUrl,
        sourceType: null,
      })
      .returning();

    // Link the race to the new event
    await db
      .update(schema.races)
      .set({ raceEventId: newEvent.id })
      .where(eq(schema.races.id, race.id));

    console.log(`  Created event "${newEvent.name}" (${uniqueSlug}) for race ${race.id}`);
    created++;
  }

  console.log(`\nCreated ${created} new race events for standalone races`);
}

async function printSummary() {
  console.log("\n=== Migration Summary ===\n");

  // Count events with slugs
  const eventsWithSlugs = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.raceEvents)
    .where(sql`${schema.raceEvents.slug} IS NOT NULL`);

  const totalEvents = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.raceEvents);

  // Count races with category_slug
  const racesWithSlugs = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.races)
    .where(sql`${schema.races.categorySlug} IS NOT NULL`);

  const totalRaces = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.races);

  // Count standalone races
  const standaloneRaces = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.races)
    .where(isNull(schema.races.raceEventId));

  console.log(`Race Events: ${eventsWithSlugs[0].count}/${totalEvents[0].count} have slugs`);
  console.log(`Races: ${racesWithSlugs[0].count}/${totalRaces[0].count} have category_slug`);
  console.log(`Standalone Races: ${standaloneRaces[0].count}`);

  // Show discipline breakdown
  const disciplineBreakdown = await db
    .select({
      discipline: schema.raceEvents.discipline,
      subDiscipline: schema.raceEvents.subDiscipline,
      count: sql<number>`count(*)`,
    })
    .from(schema.raceEvents)
    .groupBy(schema.raceEvents.discipline, schema.raceEvents.subDiscipline);

  console.log("\nDiscipline Breakdown (Race Events):");
  for (const row of disciplineBreakdown) {
    console.log(`  ${row.discipline}/${row.subDiscipline || "null"}: ${row.count}`);
  }
}

async function main() {
  console.log("Starting slug migration...\n");

  try {
    // Step 1: Migrate race events (generate slugs, consolidate disciplines)
    await migrateRaceEvents();

    // Step 2: Migrate races (generate category_slug, consolidate disciplines)
    await migrateRaces();

    // Step 3: Create events for standalone races
    await createEventsForStandaloneRaces();

    // Print summary
    await printSummary();

    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

main();
