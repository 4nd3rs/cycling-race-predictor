/** Delete bad Banyoles results for U23/Junior races, then exit */
import { config } from "dotenv";
config({ path: ".env.local" });
import { db, raceResults } from "./lib/db";
import { eq, inArray } from "drizzle-orm";

const RACE_IDS = [
  "e9b6040d-d03f-4290-8a19-2f378a0c1140", // U23 Men
  "c033c081-5954-461d-8e2c-e5e640017cf7", // Junior Women
  "943c537f-da16-4b22-8e61-553f60bc716b", // U23 Women
];

async function main() {
  for (const raceId of RACE_IDS) {
    const existing = await db.select().from(raceResults).where(eq(raceResults.raceId, raceId));
    if (existing.length === 0) {
      console.log(`  ${raceId}: already empty`);
      continue;
    }
    await db.delete(raceResults).where(eq(raceResults.raceId, raceId));
    console.log(`  ✅ Deleted ${existing.length} results for ${raceId}`);
  }
  console.log("Done");
}
main().catch(console.error).finally(() => process.exit(0));
