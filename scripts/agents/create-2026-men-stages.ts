import { db, races, raceEvents } from "./lib/db";
import { and, gte, eq, ilike } from "drizzle-orm";

async function main() {
  const toCreate = [
    {
      eventPattern: "%Paris-Nice%",
      name: "Paris-Nice - Elite Men",
      date: "2026-03-08",
      endDate: "2026-03-15",
      raceType: "stage_race" as const,
      uciCategory: "WorldTour",
      pcsUrl: "https://www.procyclingstats.com/race/paris-nice/2026",
    },
    {
      eventPattern: "%Tirreno-Adriatico%",
      name: "Tirreno-Adriatico - Elite Men",
      date: "2026-03-09",
      endDate: "2026-03-16",
      raceType: "stage_race" as const,
      uciCategory: "WorldTour",
      pcsUrl: "https://www.procyclingstats.com/race/tirreno-adriatico/2026",
    },
  ];

  for (const race of toCreate) {
    const [event] = await db.select({ id: raceEvents.id, country: raceEvents.country })
      .from(raceEvents)
      .where(and(ilike(raceEvents.name, race.eventPattern), gte(raceEvents.date, "2026-01-01")))
      .limit(1);

    if (!event) {
      console.log(`Event not found: ${race.eventPattern}`);
      continue;
    }

    // Check for existing 2026 men's race
    const existing = await db.select({ id: races.id, name: races.name, date: races.date })
      .from(races)
      .where(and(eq(races.raceEventId, event.id), eq(races.gender, "men"), gte(races.date, "2026-01-01")));

    if (existing.length > 0) {
      console.log(`Already exists: ${existing.map(r => `${r.name} (${r.date})`).join(", ")}`);
      continue;
    }

    const [created] = await db.insert(races).values({
      name: race.name,
      categorySlug: "elite-men",
      date: race.date,
      endDate: race.endDate,
      discipline: "road",
      raceType: race.raceType,
      ageCategory: "elite",
      gender: "men",
      uciCategory: race.uciCategory,
      country: event.country,
      raceEventId: event.id,
      pcsUrl: race.pcsUrl,
      status: "active",
    }).returning({ id: races.id });

    console.log(`Created: ${race.name} (${created.id}) → ${race.pcsUrl}`);
  }

  // Also fix Strade Bianche men (has /2025 URL)
  const stradeRows = await db.select({ id: races.id, name: races.name, pcsUrl: races.pcsUrl })
    .from(races)
    .where(and(ilike(races.name, "%Strade Bianche%"), eq(races.gender, "men"), gte(races.date, "2026-01-01")));

  for (const r of stradeRows) {
    if (r.pcsUrl && r.pcsUrl.includes("/2025")) {
      const fixed = r.pcsUrl.replace("/2025", "/2026");
      await db.update(races).set({ pcsUrl: fixed }).where(eq(races.id, r.id));
      console.log(`Fixed Strade Bianche men: ${r.pcsUrl} → ${fixed}`);
    }
  }
}

main().catch(console.error);
