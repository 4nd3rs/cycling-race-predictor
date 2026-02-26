import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, riders, raceResults, teams } from "./lib/db";
import { and, ilike, eq } from "drizzle-orm";

interface ResultInput {
  raceName: string;
  raceDate: string;
  riderName: string;
  position: number;
  teamName?: string;
  timeSeconds?: number | null;
  dnf?: boolean;
  dns?: boolean;
}

async function readStdin(): Promise<ResultInput[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // NDJSON fallback
  }

  const items: ResultInput[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      console.error(`Skipping invalid JSON line: ${trimmed}`);
    }
  }
  return items;
}

function normalizeRiderName(name: string): string {
  let normalized = name.trim().replace(/\s+/g, " ");

  // Handle "LAST, First" format
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  }

  // Convert to title case
  normalized = normalized
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return normalized;
}

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function findOrCreateRider(name: string): Promise<string> {
  const normalizedName = normalizeRiderName(name);

  // Try exact name match (ILIKE)
  let rider = await db.query.riders.findFirst({
    where: ilike(riders.name, normalizedName),
  });

  // Try accent-stripped match
  if (!rider) {
    const strippedName = stripAccents(normalizedName);
    if (strippedName !== normalizedName) {
      rider = await db.query.riders.findFirst({
        where: ilike(riders.name, strippedName),
      });
    }
  }

  if (rider) return rider.id;

  // Create new rider
  const [newRider] = await db
    .insert(riders)
    .values({ name: normalizedName })
    .returning();

  return newRider.id;
}

async function findOrCreateTeam(name: string): Promise<string> {
  let team = await db.query.teams.findFirst({
    where: ilike(teams.name, name),
  });

  if (team) return team.id;

  const [newTeam] = await db
    .insert(teams)
    .values({ name })
    .returning();

  return newTeam.id;
}

async function findRace(
  name: string,
  date: string
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: races.id, name: races.name })
    .from(races)
    .where(and(ilike(races.name, `%${name}%`), eq(races.date, date)))
    .limit(1);

  return row || null;
}

async function processResult(
  input: ResultInput
): Promise<"inserted" | "skipped" | "race_not_found" | "error"> {
  try {
    // Find the race
    const race = await findRace(input.raceName, input.raceDate);
    if (!race) return "race_not_found";

    // Find or create the rider
    const riderId = await findOrCreateRider(input.riderName);

    // Check if result already exists
    const [existing] = await db
      .select({ id: raceResults.id })
      .from(raceResults)
      .where(
        and(eq(raceResults.raceId, race.id), eq(raceResults.riderId, riderId))
      )
      .limit(1);

    if (existing) return "skipped";

    // Find or create team if provided
    let teamId: string | undefined;
    if (input.teamName) {
      teamId = await findOrCreateTeam(input.teamName);
    }

    // Insert result
    await db.insert(raceResults).values({
      raceId: race.id,
      riderId,
      teamId: teamId || null,
      position: input.dnf || input.dns ? null : input.position,
      timeSeconds: input.timeSeconds || null,
      dnf: input.dnf || false,
      dns: input.dns || false,
    });

    return "inserted";
  } catch (err) {
    console.error(`Error processing result for "${input.riderName}": ${err}`);
    return "error";
  }
}

async function main() {
  const items = await readStdin();

  if (items.length === 0) {
    console.log(
      JSON.stringify({
        inserted: 0,
        skipped: 0,
        raceNotFound: 0,
        errors: 0,
        message: "No input received",
      })
    );
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let raceNotFound = 0;
  let errors = 0;

  // Track which races got results so we can mark them completed
  const racesWithNewResults = new Set<string>();

  for (const item of items) {
    const result = await processResult(item);
    if (result === "inserted") {
      inserted++;
      // Track the race for completion marking
      const race = await findRace(item.raceName, item.raceDate);
      if (race) racesWithNewResults.add(race.id);
    } else if (result === "skipped") {
      skipped++;
    } else if (result === "race_not_found") {
      raceNotFound++;
    } else {
      errors++;
    }
  }

  // Mark races with results as completed
  let racesCompleted = 0;
  for (const raceId of racesWithNewResults) {
    try {
      await db
        .update(races)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(races.id, raceId));
      racesCompleted++;
    } catch (err) {
      console.error(`Error marking race ${raceId} as completed: ${err}`);
    }
  }

  console.log(
    JSON.stringify({
      inserted,
      skipped,
      raceNotFound,
      errors,
      racesCompleted,
      total: items.length,
      message: `${inserted} results inserted, ${skipped} skipped, ${raceNotFound} race not found, ${errors} errors. ${racesCompleted} races marked completed.`,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
