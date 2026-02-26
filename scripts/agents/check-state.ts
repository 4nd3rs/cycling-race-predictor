import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, count, ilike, and, isNotNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

async function main() {
  const race = await db.query.races.findFirst({ where: ilike(schema.races.name, "%Omloop%") });
  if (!race) { console.log("no race"); process.exit(1); }

  const [sl] = await db.select({ c: count() }).from(schema.raceStartlist).where(eq(schema.raceStartlist.raceId, race.id));
  const [pred] = await db.select({ c: count() }).from(schema.predictions).where(eq(schema.predictions.raceId, race.id));
  const [stats] = await db.select({ c: count() }).from(schema.riderDisciplineStats);
  const [riders] = await db.select({ c: count() }).from(schema.riders);
  const [withUci] = await db.select({ c: count() }).from(schema.riderDisciplineStats).where(isNotNull(schema.riderDisciplineStats.uciPoints));

  console.log("Startlist:", sl.c);
  console.log("Predictions:", pred.c);
  console.log("Total riders in DB:", riders.c);
  console.log("Riders with disciplineStats:", stats.c);
  console.log("Discipline stats with UCI points:", withUci.c);
}
main().catch(console.error);
