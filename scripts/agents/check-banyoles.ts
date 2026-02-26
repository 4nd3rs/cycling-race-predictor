import { config } from "dotenv";
config({ path: ".env.local" });
import { db, races, raceEvents, raceResults, riders } from "./lib/db";
import { eq, ilike } from "drizzle-orm";

async function main() {
  const events = await db.select().from(raceEvents).where(ilike(raceEvents.name, '%banyoles%'));
  
  for (const ev of events) {
    console.log(`\nEvent: ${ev.name} (${ev.id})`);
    const rs = await db.select().from(races).where(eq(races.raceEventId, ev.id));
    console.log(`  ${rs.length} races found:`);
    for (const r of rs) {
      const results = await db.select({
        pos: raceResults.position,
        riderName: riders.name,
        timeSeconds: raceResults.timeSeconds,
        dnf: raceResults.dnf,
      })
        .from(raceResults)
        .leftJoin(riders, eq(raceResults.riderId, riders.id))
        .where(eq(raceResults.raceId, r.id))
        .orderBy(raceResults.position);
      
      console.log(`\n  Race: "${r.name}" [${r.ageCategory}/${r.gender}] (${r.id})`);
      console.log(`  Date: ${r.date} | ${results.length} results`);
      results.slice(0, 5).forEach(res => {
        const dnf = res.dnf ? ' [DNF]' : '';
        console.log(`    #${res.pos}: ${res.riderName}${dnf} (${res.timeSeconds}s)`);
      });
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
