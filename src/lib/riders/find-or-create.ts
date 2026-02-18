/**
 * Centralized Rider Matching & Creation
 *
 * Single entry point for finding or creating riders and teams.
 * Replaces duplicated matching logic across import routes and sync modules.
 */

import { db, riders, teams } from "@/lib/db";
import { eq, ilike } from "drizzle-orm";
import { normalizeNationality } from "@/lib/nationality-codes";
import type { Rider, Team } from "@/lib/db/schema";

export interface RiderInput {
  name: string;
  xcoId?: string | null;
  uciId?: string | null;
  pcsId?: string | null;
  nationality?: string | null; // 2- or 3-letter code
  birthDate?: string | null;
  teamId?: string | null;
}

/**
 * Find an existing rider or create a new one.
 *
 * Matching priority:
 * 1. By xcoId (exact)
 * 2. By uciId (exact)
 * 3. By pcsId (exact)
 * 4. By normalized name (ILIKE)
 * 5. By accent-stripped name (ILIKE)
 * 6. Create new rider
 *
 * After matching, backfills any missing fields from input.
 */
export async function findOrCreateRider(input: RiderInput): Promise<Rider> {
  let rider: Rider | undefined;

  // 1. Match by xcoId
  if (input.xcoId) {
    rider = await db.query.riders.findFirst({
      where: eq(riders.xcoId, input.xcoId),
    });
  }

  // 2. Match by uciId
  if (!rider && input.uciId) {
    rider = await db.query.riders.findFirst({
      where: eq(riders.uciId, input.uciId),
    });
  }

  // 3. Match by pcsId
  if (!rider && input.pcsId) {
    rider = await db.query.riders.findFirst({
      where: eq(riders.pcsId, input.pcsId),
    });
  }

  // 4. Match by normalized name
  if (!rider) {
    const normalizedName = normalizeRiderName(input.name);
    rider = await db.query.riders.findFirst({
      where: ilike(riders.name, normalizedName),
    });

    // 5. Match by accent-stripped name
    if (!rider) {
      const strippedName = stripAccents(normalizedName);
      if (strippedName !== normalizedName) {
        rider = await db.query.riders.findFirst({
          where: ilike(riders.name, strippedName),
        });
      }
    }
  }

  // 6. Create new rider if no match
  if (!rider) {
    const nat = normalizeNationality(input.nationality);
    const [newRider] = await db
      .insert(riders)
      .values({
        name: normalizeRiderName(input.name),
        xcoId: input.xcoId || null,
        uciId: input.uciId || null,
        pcsId: input.pcsId || null,
        nationality: nat,
        birthDate: input.birthDate || null,
        teamId: input.teamId || null,
      })
      .returning();
    return newRider;
  }

  // Backfill missing fields on existing rider
  const updates: Partial<Record<string, string | null>> = {};
  if (input.xcoId && !rider.xcoId) updates.xcoId = input.xcoId;
  if (input.uciId && !rider.uciId) updates.uciId = input.uciId;
  if (input.pcsId && !rider.pcsId) updates.pcsId = input.pcsId;
  if (input.birthDate && !rider.birthDate) updates.birthDate = input.birthDate;

  const nat = normalizeNationality(input.nationality);
  if (nat && !rider.nationality) updates.nationality = nat;

  if (input.teamId && rider.teamId !== input.teamId) updates.teamId = input.teamId;

  if (Object.keys(updates).length > 0) {
    const [updated] = await db
      .update(riders)
      .set(updates)
      .where(eq(riders.id, rider.id))
      .returning();
    return updated;
  }

  return rider;
}

/**
 * Find an existing team by name or create a new one.
 */
export async function findOrCreateTeam(
  name: string,
  discipline: string = "mtb"
): Promise<Team> {
  let team = await db.query.teams.findFirst({
    where: ilike(teams.name, name),
  });

  if (!team) {
    const [newTeam] = await db
      .insert(teams)
      .values({ name, discipline })
      .returning();
    team = newTeam;
  }

  return team;
}

/**
 * Normalize rider name for matching.
 * Handles "LAST, First" format and converts to title case.
 */
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

/**
 * Strip accents from a string for fuzzy matching.
 */
function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
