import { config } from "dotenv";
config({ path: ".env.local" });

import { db, raceEvents, races } from "./lib/db";
import { and, ilike, eq } from "drizzle-orm";
import { generateEventSlug, generateCategorySlug, makeSlugUnique } from "../../src/lib/url-utils";
import { normalizeCountry } from "./lib/normalize";

interface RaceInput {
  name: string;
  date: string;
  endDate?: string;
  discipline: string;
  subDiscipline?: string;
  country?: string;
  uciCategory?: string;
  pcsUrl?: string;
  sourceUrl?: string;
  gender?: string;
  ageCategory?: string;
}

async function readStdin(): Promise<RaceInput[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return [];

  // Try parsing as JSON array first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // Fall back to NDJSON (one JSON object per line)
  }

  const items: RaceInput[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch (err) {
      console.error(`Skipping invalid JSON line: ${trimmed}`);
    }
  }
  return items;
}

async function processRace(input: RaceInput): Promise<"inserted" | "skipped" | "error"> {
  try {
    // Check if race already exists (match by name ILIKE + date)
    const [existing] = await db
      .select({ id: races.id })
      .from(races)
      .where(and(ilike(races.name, `%${input.name}%`), eq(races.date, input.date)))
      .limit(1);

    if (existing) return "skipped";

    // Also check race events
    const [existingEvent] = await db
      .select({ id: raceEvents.id })
      .from(raceEvents)
      .where(and(ilike(raceEvents.name, `%${input.name}%`), eq(raceEvents.date, input.date)))
      .limit(1);

    // Generate unique event slug
    const baseSlug = generateEventSlug(input.name);
    const existingSlugs = await db
      .select({ slug: raceEvents.slug })
      .from(raceEvents)
      .where(eq(raceEvents.discipline, input.discipline));
    const slugSet = new Set(existingSlugs.map((e) => e.slug).filter(Boolean) as string[]);
    const eventSlug = makeSlugUnique(baseSlug, slugSet);

    let eventId: string;

    if (existingEvent) {
      eventId = existingEvent.id;
    } else {
      const [newEvent] = await db
        .insert(raceEvents)
        .values({
          name: input.name,
          slug: eventSlug,
          date: input.date,
          endDate: input.endDate || null,
          discipline: input.discipline,
          subDiscipline: input.subDiscipline || null,
          country: normalizeCountry(input.country) ?? null,
          sourceUrl: input.sourceUrl || input.pcsUrl || null,
          sourceType: "agent",
        })
        .returning();
      eventId = newEvent.id;
    }

    // Determine which gender-specific races to create
    const genders = input.gender ? [input.gender] : ["men", "women"];
    const ageCategory = input.ageCategory || "elite";

    for (const gender of genders) {
      const categorySlug = generateCategorySlug(ageCategory, gender);
      const raceName =
        genders.length === 1
          ? input.name
          : `${input.name} - ${ageCategory.charAt(0).toUpperCase() + ageCategory.slice(1)} ${gender.charAt(0).toUpperCase() + gender.slice(1)}`;

      // Check this specific race doesn't already exist
      const [existingRace] = await db
        .select({ id: races.id })
        .from(races)
        .where(
          and(
            eq(races.raceEventId, eventId),
            eq(races.ageCategory, ageCategory),
            eq(races.gender, gender)
          )
        )
        .limit(1);

      if (existingRace) continue;

      await db.insert(races).values({
        name: raceName,
        categorySlug,
        date: input.date,
        endDate: input.endDate || null,
        discipline: input.discipline,
        raceType: input.subDiscipline || (input.endDate ? "stage_race" : "one_day"),
        ageCategory,
        gender,
        uciCategory: input.uciCategory || null,
        country: normalizeCountry(input.country) ?? null,
        raceEventId: eventId,
        pcsUrl: input.pcsUrl || null,
        status: "active",
      });
    }

    return "inserted";
  } catch (err) {
    console.error(`Error processing race "${input.name}": ${err}`);
    return "error";
  }
}

async function main() {
  const items = await readStdin();

  if (items.length === 0) {
    console.log(JSON.stringify({ inserted: 0, skipped: 0, errors: 0, message: "No input received" }));
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    const result = await processRace(item);
    if (result === "inserted") inserted++;
    else if (result === "skipped") skipped++;
    else errors++;
  }

  console.log(
    JSON.stringify({
      inserted,
      skipped,
      errors,
      total: items.length,
      message: `${inserted} inserted, ${skipped} skipped (already exist), ${errors} errors`,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
