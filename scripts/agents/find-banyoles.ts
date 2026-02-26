import { config } from "dotenv";
config({ path: "/Users/amalabs/cycling-race-predictor/.env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { ilike } from "drizzle-orm";
import * as schema from "/Users/amalabs/cycling-race-predictor/src/lib/db/schema";
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
async function main() {
  const races = await db.query.races.findMany({ where: ilike(schema.races.name, "%anyoles%") });
  const events = await db.query.raceEvents.findMany({ where: ilike(schema.raceEvents.name, "%anyoles%") });
  console.log("Races:", JSON.stringify(races.map(r => ({id:r.id, name:r.name, date:r.date, status:r.status})), null, 2));
  console.log("Events:", JSON.stringify(events.map(e => ({id:e.id, name:e.name, date:e.date})), null, 2));
}
main().catch(console.error);
