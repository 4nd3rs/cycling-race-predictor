import { config } from "dotenv";
config({ path: ".env.local" });
import { db, riders, riderRumours } from "./lib/db";
import { eq, lt, gt, sql } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    riderName: riders.name,
    aggregateScore: riderRumours.aggregateScore,
    tipCount: riderRumours.tipCount,
    summary: riderRumours.summary,
    lastUpdated: riderRumours.lastUpdated,
  }).from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .orderBy(riderRumours.lastUpdated);

  // Flag likely injury/negative sentiment (score < -0.3)
  const negative = rows.filter((r: any) => parseFloat(r.aggregateScore) < -0.3);
  const positive = rows.filter((r: any) => parseFloat(r.aggregateScore) > 0.3);

  console.log(JSON.stringify({ total: rows.length, negative, positive }, null, 2));
}

main().catch(console.error);
