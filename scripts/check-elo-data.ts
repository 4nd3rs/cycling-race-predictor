import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { desc, sql, eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

async function check() {
  // Count riders with Elo data
  const ridersWithElo = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.riderDisciplineStats);

  // Count total results
  const totalResults = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.raceResults);

  // Top 10 riders by Elo
  const topRiders = await db
    .select({
      name: schema.riders.name,
      nationality: schema.riders.nationality,
      elo: schema.riderDisciplineStats.currentElo,
      uciPoints: schema.riderDisciplineStats.uciPoints,
      races: schema.riderDisciplineStats.racesTotal,
    })
    .from(schema.riderDisciplineStats)
    .innerJoin(schema.riders, eq(schema.riderDisciplineStats.riderId, schema.riders.id))
    .where(eq(schema.riderDisciplineStats.discipline, "mtb"))
    .orderBy(desc(schema.riderDisciplineStats.currentElo))
    .limit(10);

  console.log("=== Database Stats ===");
  console.log("Riders with Elo ratings:", ridersWithElo[0]?.count || 0);
  console.log("Total race results:", totalResults[0]?.count || 0);
  console.log("");
  console.log("=== Top 10 Riders by Elo ===");
  topRiders.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.name} (${r.nationality || "??"}) - Elo: ${r.elo} (${r.races} races)`
    );
  });
}

check().catch(console.error);
