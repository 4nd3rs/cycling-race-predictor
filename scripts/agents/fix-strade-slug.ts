import { db, races } from "./lib/db";
import { eq } from "drizzle-orm";

async function main() {
  // Remove categorySlug from the old 2025 race so it won't match URL routing
  const OLD_RACE_ID = "af7407a4-134c-4689-b4ac-604291de61f2";
  await db.update(races).set({ categorySlug: null }).where(eq(races.id, OLD_RACE_ID));
  console.log("Cleared categorySlug on old 2025 Strade Bianche race");
}

main().catch(console.error);
