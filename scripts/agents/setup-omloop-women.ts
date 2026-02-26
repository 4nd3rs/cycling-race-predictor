/**
 * Setup Omloop Het Nieuwsblad Elite Women 2026
 * 1. Set PCS URL on the race
 * 2. Done — startlist sync will pick it up
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const WOMEN_RACE_ID = "f6f9ae0b-13ef-4f29-accf-35719f187ccf";
const PCS_URL = "https://www.procyclingstats.com/race/omloop-het-nieuwsblad-elite-women/2026";

async function main() {
  // Set PCS URL + make sure status is active + date is correct
  await db.update(schema.races)
    .set({
      pcsUrl: PCS_URL,
      status: "active",
      date: "2026-02-28",
      discipline: "road",
      raceType: "one_day",
      profileType: "cobbles",
      uciCategory: "WorldTour",
      country: "BEL",
    })
    .where(eq(schema.races.id, WOMEN_RACE_ID));

  console.log("✅ Updated Women's Omloop race with PCS URL and metadata");
  console.log("   Race ID:", WOMEN_RACE_ID);
  console.log("   PCS URL:", PCS_URL);
}

main().catch(console.error).finally(() => process.exit(0));
