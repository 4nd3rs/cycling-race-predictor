import { config } from "dotenv";
config({ path: ".env.local" });
import { db, races } from "./lib/db";
import { gte } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({ id: races.id, name: races.name, date: races.date })
    .from(races)
    .where(gte(races.date, "2026-04-01"))
    .orderBy(races.date);

  for (const r of rows) {
    console.log(r.id + '\t' + r.date + '\t' + r.name);
  }
  process.exit(0);
}
main();
