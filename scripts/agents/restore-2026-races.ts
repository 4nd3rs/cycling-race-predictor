/**
 * Restores deleted 2026 Paris-Nice and Tirreno-Adriatico race rows.
 * Race events are intact; only the race rows (+ startlists/predictions) were cascade-deleted.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races } from "./lib/db";

async function main() {
  const toRestore = [
    {
      id: "a239fc14-7e4a-4e62-953e-c1d5c40048b6",
      raceEventId: "8a4857ca-04fa-4639-a609-2c91031ca6a5", // Paris-Nice event
      name: "Paris-Nice",
      date: "2026-03-08",
      gender: "men",
      ageCategory: "elite",
      categorySlug: "elite-men",
      uciCategory: "2.UWT",
      pcsUrl: "https://www.procyclingstats.com/race/paris-nice/2026",
      status: "active",
    },
    {
      id: "162b4ef0-4776-4f67-9d72-ec206ed07fdf",
      raceEventId: "63ec84ea-15a6-47a9-bc31-0784c246a690", // Tirreno-Adriatico event
      name: "Tirreno-Adriatico",
      date: "2026-03-09",
      gender: "men",
      ageCategory: "elite",
      categorySlug: "elite-men",
      uciCategory: "2.UWT",
      pcsUrl: "https://www.procyclingstats.com/race/tirreno-adriatico/2026",
      status: "active",
    },
  ];

  for (const r of toRestore) {
    await db.insert(races).values({
      id: r.id,
      name: r.name,
      raceEventId: r.raceEventId,
      date: r.date,
      gender: r.gender as "men" | "women",
      ageCategory: r.ageCategory,
      categorySlug: r.categorySlug,
      discipline: "road" as const,
      uciCategory: r.uciCategory,
      pcsUrl: r.pcsUrl,
      status: r.status as "active",
    }).onConflictDoNothing();
    console.log(`✅ Restored: ${r.name} 2026 (${r.id})`);
  }

  console.log("\nDone. Now re-sync startlists for both races via sync-startlists.");
}

main().catch(console.error);
