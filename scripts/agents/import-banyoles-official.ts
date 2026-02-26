/**
 * Import full official results from Shimano Supercup Massi Banyoles 2026
 * Source: Official PDF results via LLMWhisperer
 * Men: https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Elite.pdf
 * Women: https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Feminas.pdf
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Convert "LASTNAME Firstname" (PDF format) to "Firstname Lastname"
function normalizeName(pdfName: string): string {
  const parts = pdfName.trim().split(/\s+/);
  if (parts.length < 2) return pdfName;
  // Last token is first name, rest is surname
  const firstName = parts[parts.length - 1];
  const lastName = parts.slice(0, -1).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
  return `${firstName} ${lastName}`;
}

// Parse "1h22:05.23" or "5.06" (gap) to seconds
function parseTime(t: string): number | null {
  if (!t || t.trim() === "") return null;
  const m1 = t.match(/(\d+)h(\d+):(\d+)\.(\d+)/);
  if (m1) return parseInt(m1[1]) * 3600 + parseInt(m1[2]) * 60 + parseInt(m1[3]);
  const m2 = t.match(/(\d+):(\d+)\.(\d+)/);
  if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]);
  const m3 = t.match(/^(\d+)\.(\d+)$/);
  if (m3) return parseInt(m3[1]);
  return null;
}

const MEN_RESULTS = [
  { pos: 1,  name: "Victor Koretzky",            team: "Specialized Factory Racing",          nat: "FRA", time: "1h22:00.17" },
  { pos: 2,  name: "Dario Lillo",                 team: "Giant Factory Off-Road Team",         nat: "SUI", time: "1h22:05.23" },
  { pos: 3,  name: "Luca Schwarzbauer",           team: "Canyon XC Racing",                    nat: "GER", time: "1h22:17.34" },
  { pos: 4,  name: "Sebastian Fini Juul",         team: "Mondraker Factory Racing",            nat: "DEN", time: "1h22:17.85" },
  { pos: 5,  name: "Jordan Sarrou",               team: "BMC Factory Racing",                  nat: "FRA", time: "1h22:18.99" },
  { pos: 6,  name: "Pierre Defroidmont",          team: "Orbea Fox Factory Team",              nat: "BEL", time: "1h22:20.02" },
  { pos: 7,  name: "David List",                  team: "Decathlon Ford Racing Team",          nat: "GER", time: "1h22:21.88" },
  { pos: 8,  name: "Jens Schuermans",             team: "Giant Factory Off-Road Team",         nat: "BEL", time: "1h22:32.36" },
  { pos: 9,  name: "Paul Schehl",                 team: "National Team Germany",               nat: "GER", time: "1h22:44.05" },
  { pos: 10, name: "William Handley",             team: "Team WO2 Max",                        nat: "GBR", time: "1h22:56.72" },
  { pos: 11, name: "Luke Moir",                   team: "Mondraker Factory Racing",            nat: "NZL", time: "1h22:58.20" },
  { pos: 12, name: "Tobias Lillelund",            team: "Lapierre PXR Racing",                 nat: "DEN", time: "1h22:58.50" },
  { pos: 13, name: "Titouan Carod",              team: "BMC Factory Racing",                  nat: "FRA", time: "1h23:01.30" },
  { pos: 14, name: "Mario Bair",                  team: "Cabtech Racing",                      nat: "AUT", time: "1h23:02.96" },
  { pos: 15, name: "Tom Schellekens",             team: "KMC Nukeproof MTB Racing Team",       nat: "NED", time: "1h23:13.78" },
  { pos: 16, name: "Antoine Philipp",             team: "Massi",                               nat: "FRA", time: "1h23:25.99" },
  { pos: 17, name: "Nick Burki",                  team: "Bike Team Solothurn",                 nat: "SUI", time: "1h23:27.39" },
  { pos: 18, name: "Mats Glende",                 team: "Massi",                               nat: "NOR", time: "1h23:27.67" },
  { pos: 19, name: "Matteo Siffredi",             team: "KTM Protek Elettrosystem",            nat: "ITA", time: "1h23:31.09" },
  { pos: 20, name: "Luke Wiedmann",               team: "BMC Factory Racing",                  nat: "USA", time: "1h23:31.87" },
  { pos: 21, name: "Anton Cooper",                team: "Lapierre PXR Racing",                 nat: "NZL", time: "1h23:55.86" },
  { pos: 22, name: "Joshua Dubau",                team: "Decathlon Ford Racing Team",          nat: "FRA", time: "1h24:38.21" },
  { pos: 23, name: "Thomas Griot",                team: "SUNN Factory Racing",                 nat: "FRA", time: "1h25:06.19" },
  { pos: 24, name: "Corran Carrick-Anderson",     team: "Hope Factory Racing",                 nat: "GBR", time: "1h25:13.63" },
  { pos: 25, name: "Yann Chaptal",                team: "Scott Creuse Oxygène Guéret",        nat: "FRA", time: "1h25:19.11" },
  { pos: 26, name: "Jarne Vandersteen",           team: "Orbea Nextgen Racinteam",             nat: "BEL", time: "1h25:20.97" },
  { pos: 27, name: "Tomer Zaltsman",             team: "HD Trek",                             nat: "ISR", time: "1h25:38.64" },
  { pos: 28, name: "Gian Bütikofer",              team: "Engadin Bike Team",                   nat: "SUI", time: "1h25:44.30" },
  { pos: 29, name: "Chris Van Dijk",              team: "Scott Zwiep MTB Team",                nat: "NED", time: "1h26:04.62" },
  { pos: 30, name: "Jan Saska",                   team: "Subterra MTB Team",                   nat: "CZE", time: "1h27:17.39" },
  { pos: 31, name: "André Eriksson",              team: "Varbergs MTB",                        nat: "SWE", time: "1h27:38.78" },
  { pos: 32, name: "Paweł Bernas",               team: "Team Voster",                         nat: "POL", time: "1h28:23.63" },
  { pos: 33, name: "Esteban Bagnon",             team: "Istres Sport Cyclisme",               nat: "FRA", time: "1h28:41.88" },
  { pos: 34, name: "Emilien Brunet",              team: "Team Risoul MTB Racing",              nat: "FRA", time: "1h28:42.78" },
  { pos: 35, name: "Riki O'Malley Kitabayashi",  team: "Unno Factory Racing",                 nat: "JPN", time: "1h28:52.19" },
  { pos: 36, name: "Ben Schweizer",               team: "Stop&Go Marderabwehr MTB Team",       nat: "USA", time: "1h29:14.53" },
  { pos: 37, name: "Mario Sinués Micó",          team: "Amunt T-Bikes",                       nat: "ESP", time: "1h29:28.75" },
  { pos: 38, name: "Jofre Cullell Estape",        team: "BH Coloma Team",                      nat: "ESP", time: "1h29:42.59" },
  // DNF (notable)
  { pos: null, name: "Samuel Gaze",               team: "Alpecin Premiertech",                 nat: "NZL", time: null, dnf: true },
  { pos: null, name: "Simon Andreassen",          team: "Orbea Fox Factory Team",              nat: "DEN", time: null, dns: true },
];

const WOMEN_RESULTS = [
  { pos: 1,  name: "Nicole Koller",               team: "Lapierre PXR Racing",                 nat: "SUI", time: "1h18:36.24" },
  { pos: 2,  name: "Valentina Corvi",             team: "Canyon XC Racing",                    nat: "ITA", time: "1h18:52.86" },
  { pos: 3,  name: "Kelsey Urban",                team: "KMC Nukeproof MTB Racing Team",       nat: "USA", time: "1h19:23.76" },
  { pos: 4,  name: "Jennifer Jackson",            team: "Orbea Fox Factory Team",              nat: "CAN", time: "1h19:24.88" },
  { pos: 5,  name: "Sara Cortinovis",             team: "Unno Factory Racing",                 nat: "ITA", time: "1h19:59.66" },
  { pos: 6,  name: "Caroline Bohe",               team: "Lapierre PXR Racing",                 nat: "DEN", time: "1h20:08.33" },
  { pos: 7,  name: "Vita Movrin",                 team: "SUNN Factory Racing",                 nat: "SLO", time: "1h20:34.13" },
  { pos: 8,  name: "Lia Schreivers",              team: "German National Team",                nat: "GER", time: "1h21:04.27" },
  { pos: 9,  name: "Anne Terpstra",               team: "Lapierre PXR Racing",                 nat: "NED", time: "1h21:22.35" },
  { pos: 10, name: "Sina Van Thiel",              team: "National Team Germany",               nat: "GER", time: "1h22:13.74" },
  { pos: 11, name: "Mona Mitterwallner",          team: "Mondraker Factory Racing",            nat: "AUT", time: "1h22:41.82" },
  { pos: 12, name: "Chiara Teocchi",              team: "BH Coloma Team",                      nat: "ITA", time: "1h22:52.74" },
  { pos: 13, name: "Isla Short",                  team: "Short Factory Racing",                nat: "GBR", time: "1h23:02.94" },
  { pos: 14, name: "Seraina Leugger",             team: "Cabtech Racing",                      nat: "SUI", time: "1h23:11.74" },
  { pos: 15, name: "Tina Züger",                  team: "Bike Team Solothurn",                 nat: "SUI", time: "1h23:15.30" },
  { pos: 16, name: "Raquel Queirós",             team: "Selecão Nacional Portuguesa",         nat: "POR", time: "1h23:26.44" },
  { pos: 17, name: "Estibaliz Sagardoy",          team: "Saltoki Orbea Development",           nat: "ESP", time: "1h25:30.37" },
  { pos: 18, name: "Lucia Gomez Andreu",          team: "Extremadura-Petrogold",               nat: "ESP", time: "1h25:41.50" },
  { pos: 19, name: "Noémie Medina",              team: "XC63 Volcanic Team",                  nat: "FRA", time: "1h25:41.83" },
  { pos: 20, name: "Noelle Buri",                 team: "Unno Factory Racing",                 nat: "SUI", time: "1h26:16.44" },
  { pos: 21, name: "Jitka Cabelicka",             team: "Cabtech Racing",                      nat: "CZE", time: "1h26:54.75" },
];

async function findOrCreateTeam(name: string): Promise<string> {
  const ex = await db.query.teams.findFirst({ where: ilike(schema.teams.name, name) });
  if (ex) return ex.id;
  const [c] = await db.insert(schema.teams).values({ name, discipline: "mtb" }).returning({ id: schema.teams.id });
  return c.id;
}

async function findOrCreateRider(name: string, teamId: string, nat: string): Promise<string> {
  const ex = await db.query.riders.findFirst({ where: ilike(schema.riders.name, name) });
  if (ex) {
    await db.update(schema.riders).set({ teamId, nationality: nat as any }).where(eq(schema.riders.id, ex.id));
    return ex.id;
  }
  const all = await db.select({ id: schema.riders.id, name: schema.riders.name }).from(schema.riders).limit(10000);
  const stripped = stripAccents(name);
  const match = all.find(r => stripAccents(r.name) === stripped);
  if (match) {
    await db.update(schema.riders).set({ teamId, nationality: nat as any }).where(eq(schema.riders.id, match.id));
    return match.id;
  }
  const [c] = await db.insert(schema.riders).values({ name, teamId, nationality: nat as any }).returning({ id: schema.riders.id });
  return c.id;
}

async function importResults(raceId: string, raceLabel: string, results: typeof MEN_RESULTS) {
  console.log(`\n--- ${raceLabel} (${raceId}) ---`);

  // Delete existing results
  const deleted = await db.delete(schema.raceResults).where(eq(schema.raceResults.raceId, raceId));
  console.log(`  Cleared existing results`);

  // Also delete ELO history so it can be recalculated fresh
  await db.delete(schema.eloHistory).where(eq(schema.eloHistory.raceId, raceId));

  let inserted = 0, errors = 0;
  for (const r of results) {
    try {
      const teamId = await findOrCreateTeam(r.team);
      const riderId = await findOrCreateRider(r.name, teamId, r.nat);
      const timeSeconds = parseTime(r.time ?? "");

      await db.insert(schema.raceResults).values({
        raceId,
        riderId,
        teamId,
        position: r.pos ?? undefined,
        timeSeconds: timeSeconds ?? undefined,
        dnf: (r as any).dnf || false,
        dns: (r as any).dns || false,
      });
      inserted++;
      if (r.pos && r.pos <= 10) console.log(`  ${r.pos}. ${r.name} — ${r.time}`);
    } catch (err: any) {
      console.error(`  ❌ ${r.name}: ${err.message}`);
      errors++;
    }
  }

  // Mark race completed
  await db.update(schema.races).set({ status: "completed" }).where(eq(schema.races.id, raceId));

  console.log(`  ✅ ${inserted} inserted, ${errors} errors`);
  return inserted;
}

async function main() {
  // Get race IDs
  const menRace = await db.query.races.findFirst({
    where: and(ilike(schema.races.name, "%Banyoles%"), ilike(schema.races.name, "%Elite Men%")),
  });
  const womenRace = await db.query.races.findFirst({
    where: and(ilike(schema.races.name, "%Banyoles%"), ilike(schema.races.name, "%Elite Women%")),
  });

  if (!menRace) { console.error("Men's race not found"); process.exit(1); }
  if (!womenRace) { console.error("Women's race not found"); process.exit(1); }

  console.log(`Found: ${menRace.name} (${menRace.id})`);
  console.log(`Found: ${womenRace.name} (${womenRace.id})`);

  await importResults(menRace.id, "Elite Men", MEN_RESULTS);
  await importResults(womenRace.id, "Elite Women", WOMEN_RESULTS);

  console.log("\n✅ Import complete — triggering ELO recalculation...");
}

main().catch(console.error);
