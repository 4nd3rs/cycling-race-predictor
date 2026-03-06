/**
 * notify-followers.ts
 * Stub — individual follower notifications removed (WhatsApp group posting handles this now).
 * Kept for import compatibility; all functions return 0.
 */
import { db, races, raceEvents } from "@/lib/db";
import { eq } from "drizzle-orm";

export interface RaceSection {
  raceId: string;
  categoryLabel: string;
  tgSection: string;
  waSection: string;
}

export async function notifyRaceFollowers(_raceId: string, _message: string, _eventType?: string): Promise<number> { return 0; }
export async function notifyRaceEventFollowers(_raceEventId: string, _message: string, _eventType?: string): Promise<number> { return 0; }
export async function notifyRiderFollowers(_riderId: string, _message: string, _eventType?: string): Promise<number> { return 0; }
export async function notifyRaceEventCombined(_raceEventId: string, _raceSections: RaceSection[], ..._args: string[]): Promise<number> { return 0; }

export async function getRaceEventId(raceId: string): Promise<string | null> {
  const [row] = await db.select({ raceEventId: races.raceEventId }).from(races).where(eq(races.id, raceId)).limit(1);
  return row?.raceEventId ?? null;
}

export async function getRaceEventInfo(raceEventId: string): Promise<{ name: string; slug: string | null; discipline: string } | null> {
  const [row] = await db.select({ name: raceEvents.name, slug: raceEvents.slug, discipline: raceEvents.discipline }).from(raceEvents).where(eq(raceEvents.id, raceEventId)).limit(1);
  return row ?? null;
}
