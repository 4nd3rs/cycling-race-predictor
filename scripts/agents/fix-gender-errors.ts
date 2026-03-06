import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents } from "./lib/db";
import { eq, ilike, or } from "drizzle-orm";

async function main() {
  // Find all three by event name pattern
  const targets = await db.select({ id: races.id, gender: races.gender, name: raceEvents.name, slug: raceEvents.slug })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(or(
      ilike(raceEvents.name, "%extremadura%"),
      ilike(raceEvents.name, "%trofeo%oro%euro%"),
      ilike(raceEvents.name, "%poreč%classic%ladies%"),
      ilike(raceEvents.name, "%porec%classic%ladies%"),
      ilike(raceEvents.slug, "%porec-classic-ladies%"),
    ));

  if (targets.length === 0) {
    console.log("No matching races found.");
    return;
  }

  for (const r of targets) {
    console.log(`${r.name} (${r.id}) — current gender: ${r.gender}`);
    await db.update(races).set({ gender: "women" }).where(eq(races.id, r.id));
    console.log(`  → fixed to gender=women ✅`);
  }

  console.log(`\nFixed ${targets.length} races.`);
}

main().catch(console.error);
