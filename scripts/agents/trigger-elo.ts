import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, notExists } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { processRaceElo } from "../../src/lib/prediction/process-race-elo";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

async function main() {
  // Find completed races without ELO history
  const completedRaces = await db.query.races.findMany({
    where: and(
      eq(schema.races.status, "completed"),
      notExists(
        db.select({ id: schema.eloHistory.id })
          .from(schema.eloHistory)
          .where(eq(schema.eloHistory.raceId, schema.races.id))
      )
    ),
  });

  console.log(`Found ${completedRaces.length} completed races without ELO processed`);

  for (const race of completedRaces) {
    try {
      console.log(`Processing ELO for: ${race.name} (${race.date})`);
      const updates = await processRaceElo(race.id);
      console.log(`  ✅ ${updates} ELO updates`);
    } catch (err: any) {
      console.error(`  ❌ ${race.name}: ${err.message}`);
    }
  }
}
main().catch(console.error);
