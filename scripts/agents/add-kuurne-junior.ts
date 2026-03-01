import { db, races } from "./lib/db";
import { eq } from "drizzle-orm";

async function main() {
  // 1. Fix elite-men categorySlug (currently null)
  const eliteRaceId = "2890d292-54f9-473a-a32c-ca3e591fc3f6";
  await db.update(races).set({ categorySlug: "elite-men" }).where(eq(races.id, eliteRaceId));
  console.log("Fixed elite-men categorySlug");

  // 2. Create junior-men race under same event
  const eventId = "9a66950d-b0be-4634-8ba5-afc969cc35b5";
  const [created] = await db
    .insert(races)
    .values({
      name: "Kuurne - Brussel - Kuurne 2026 - Junior Men",
      categorySlug: "junior-men",
      date: "2026-03-01",
      discipline: "road",
      raceType: "one_day",
      ageCategory: "junior",
      gender: "men",
      country: "BEL",
      raceEventId: eventId,
      pcsUrl: "https://www.procyclingstats.com/race/kuurne-brussel-kuurne-juniors/2026",
      status: "active",
    })
    .returning({ id: races.id });

  console.log("Created junior-men race:", created.id);
}

main().catch(console.error);
