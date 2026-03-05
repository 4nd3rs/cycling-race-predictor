import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents } from "./lib/db";
import { eq, sql, and } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    raceId: races.id,
    raceName: raceEvents.name,
    gender: races.gender,
    discipline: raceEvents.discipline,
    date: races.date,
    pcsUrl: races.pcsUrl,
    status: races.status,
    startlist: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
    results: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
  }).from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.status, "active"),
      eq(races.gender, "women"),
      eq(raceEvents.discipline, "road")
    ))
    .orderBy(races.date);

  const phantoms = rows.filter(r => Number(r.startlist) === 0 && Number(r.results) === 0);
  console.log(`Total women road races: ${rows.length}`);
  console.log(`Zero startlist + results (potential phantoms): ${phantoms.length}\n`);
  for (const r of phantoms) {
    console.log(`${r.date} | ${r.raceName} | id=${r.raceId} | pcsUrl=${r.pcsUrl ?? "NULL"}`);
  }
}

main().catch(console.error);
