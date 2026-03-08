import { db, riders, races, raceEvents, raceResults } from "../src/lib/db";
import { eq, and, ilike } from "drizzle-orm";

interface ContaminationCase {
  eventName: string;
  riderName: string;
  // The WRONG race category to remove from
  wrongAgeCategory: string;
  wrongGender: string;
}

const cases: ContaminationCase[] = [
  // junior-men <-> elite-women: remove from elite-women
  { eventName: "The Showdown @Angler's Ridge", riderName: "Jora Macrea Ian", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Portugal CUP XCO - XCO Jamor", riderName: "Céu Martim", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Ac Heating Cup Ústí Nad Labem", riderName: "Zahálka Lukáš", wrongAgeCategory: "junior", wrongGender: "women" },
  { eventName: "3 Nations Cup - MTB Weekend Eupen", riderName: "Orrin Van Mele", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Coupe du Japon Hakusan Ichirino International", riderName: "Mitsui Ryo", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Lloyds National Cross Country MTB Series Round 4", riderName: "Ryan Young", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Polish National Championships - XCO", riderName: "Dominik Jankowski", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "JOC Junior Cup / National Youth Mountain Bike", riderName: "Yuga Ikuta", wrongAgeCategory: "junior", wrongGender: "women" },
  // u23-men <-> elite-women: remove from elite-women
  { eventName: "Guatemalan National Championships - XCO", riderName: "Ariel Aaron Eugenio Moreira Quintanilla", wrongAgeCategory: "elite", wrongGender: "women" },
  { eventName: "Copa Aguavista XCO", riderName: "Adolfo Barrios Almeida", wrongAgeCategory: "elite", wrongGender: "women" },
  // elite-men <-> elite-women: Eva is a woman, remove from elite-men
  { eventName: "American Continental Championship - XCO - XCC - XCE - E-XC", riderName: "Eva Guadalupe Jimenez Patiño", wrongAgeCategory: "elite", wrongGender: "men" },
];

async function main() {
  console.log("Starting cross-gender contamination cleanup...\n");
  let totalDeleted = 0;

  for (const c of cases) {
    // Find the rider
    const riderRows = await db
      .select({ id: riders.id, name: riders.name })
      .from(riders)
      .where(ilike(riders.name, c.riderName));

    if (riderRows.length === 0) {
      console.log(`[SKIP] Rider not found: "${c.riderName}"`);
      continue;
    }
    if (riderRows.length > 1) {
      console.log(`[WARN] Multiple riders found for "${c.riderName}": ${riderRows.map(r => r.id).join(", ")}`);
    }
    const rider = riderRows[0];

    // Find the wrong race: join races with raceEvents
    const wrongRaces = await db
      .select({ raceId: races.id, raceName: races.name, eventName: raceEvents.name })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(
        and(
          ilike(raceEvents.name, `%${c.eventName}%`),
          eq(races.ageCategory, c.wrongAgeCategory),
          eq(races.gender, c.wrongGender)
        )
      );

    if (wrongRaces.length === 0) {
      console.log(`[SKIP] No matching race for event="${c.eventName}" ageCategory=${c.wrongAgeCategory} gender=${c.wrongGender}`);
      continue;
    }
    if (wrongRaces.length > 1) {
      console.log(`[WARN] Multiple races matched for "${c.eventName}" (${c.wrongAgeCategory}-${c.wrongGender}): ${wrongRaces.map(r => r.raceId).join(", ")}`);
    }

    const wrongRace = wrongRaces[0];

    // Delete the result
    const deleted = await db
      .delete(raceResults)
      .where(
        and(
          eq(raceResults.raceId, wrongRace.raceId),
          eq(raceResults.riderId, rider.id)
        )
      )
      .returning({ id: raceResults.id });

    if (deleted.length > 0) {
      console.log(`[DELETED] "${rider.name}" from "${wrongRace.raceName}" (${c.wrongAgeCategory}-${c.wrongGender}) - resultId: ${deleted[0].id}`);
      totalDeleted++;
    } else {
      console.log(`[NOT FOUND] No result for "${rider.name}" in race "${wrongRace.raceName}" (${c.wrongAgeCategory}-${c.wrongGender})`);
    }
  }

  console.log(`\nDone. Deleted ${totalDeleted} contaminated results out of ${cases.length} cases.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
