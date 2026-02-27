import { config } from "dotenv";
config({ path: ".env.local" });
import { db, races } from "./lib/db";
import { gte } from "drizzle-orm";
async function main() {
  const result = await db.select({ id: races.id, name: races.name, date: races.date, discipline: races.discipline, gender: races.gender, ageCategory: races.ageCategory })
    .from(races)
    .where(gte(races.date, "2026-04-01"))
    .orderBy(races.date);
  console.log(JSON.stringify(result));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
