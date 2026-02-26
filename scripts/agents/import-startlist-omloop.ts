import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const riders = [
  // Alpecin-Premier Tech
  { name: "Mathieu van der Poel", team: "Alpecin-Premier Tech", nationality: "NED" },
  { name: "Jasper Philipsen", team: "Alpecin-Premier Tech", nationality: "BEL" },
  { name: "Kaden Groves", team: "Alpecin-Premier Tech", nationality: "AUS" },
  // Visma Lease a Bike
  { name: "Wout van Aert", team: "Team Visma | Lease a Bike", nationality: "BEL" },
  { name: "Matthew Brennan", team: "Team Visma | Lease a Bike", nationality: "GBR" },
  { name: "Christophe Laporte", team: "Team Visma | Lease a Bike", nationality: "FRA" },
  // Q36.5
  { name: "Tom Pidcock", team: "Pinarello - Q36.5 Pro Cycling Team", nationality: "GBR" },
  // Uno-X
  { name: "Søren Wærenskjold", team: "Uno-X Mobility", nationality: "NOR" },
  // Decathlon
  { name: "Tiesj Benoot", team: "Decathlon CMA CGM Team", nationality: "BEL" },
  // UAE
  { name: "Tim Wellens", team: "UAE Team Emirates XRG", nationality: "BEL" },
  { name: "Florian Vermeersch", team: "UAE Team Emirates XRG", nationality: "BEL" },
  // Soudal
  { name: "Dylan van Baarle", team: "Soudal - Quick-Step", nationality: "NED" },
  { name: "Yves Lampaert", team: "Soudal - Quick-Step", nationality: "BEL" },
  { name: "Jasper Stuyven", team: "Soudal - Quick-Step", nationality: "BEL" },
  // INEOS
  { name: "Ben Turner", team: "INEOS Grenadiers", nationality: "GBR" },
  { name: "Magnus Sheffield", team: "INEOS Grenadiers", nationality: "USA" },
  // Bahrain
  { name: "Matej Mohorič", team: "Bahrain Victorious", nationality: "SLO" },
  // Lidl-Trek
  { name: "Otto Vergaerde", team: "Lidl - Trek", nationality: "BEL" },
  { name: "Edward Theuns", team: "Lidl - Trek", nationality: "BEL" },
  // Bora
  { name: "Jordi Meeus", team: "Red Bull - BORA - hansgrohe", nationality: "BEL" },
  // NSN
  { name: "Biniam Girmay", team: "NSN Cycling Team", nationality: "ERI" },
];

async function findOrCreateTeam(teamName: string) {
  const existing = await db.query.teams.findFirst({
    where: ilike(schema.teams.name, teamName),
  });
  if (existing) return existing;
  const [created] = await db.insert(schema.teams).values({ name: teamName, discipline: "road" }).returning();
  return created;
}

async function findOrCreateRider(name: string, teamId: string, nationality: string) {
  const existing = await db.query.riders.findFirst({
    where: ilike(schema.riders.name, name),
  });
  if (existing) {
    await db.update(schema.riders).set({ teamId, nationality: nationality as any }).where(eq(schema.riders.id, existing.id));
    return existing;
  }
  const [created] = await db.insert(schema.riders).values({ name, teamId, nationality: nationality as any }).returning();
  return created;
}

async function main() {
  // Find the race
  const race = await db.query.races.findFirst({
    where: ilike(schema.races.name, "%Omloop Het Nieuwsblad 2026%"),
  });
  if (!race) { console.log("Race not found!"); process.exit(1); }
  console.log("Found race:", race.name, race.id);

  let inserted = 0, skipped = 0;
  for (const r of riders) {
    try {
      const team = await findOrCreateTeam(r.team);
      const rider = await findOrCreateRider(r.name, team.id, r.nationality);
      // Check if already in startlist
      const existing = await db.query.raceStartlist.findFirst({
        where: and(eq(schema.raceStartlist.raceId, race.id), eq(schema.raceStartlist.riderId, rider.id)),
      });
      if (!existing) {
        await db.insert(schema.raceStartlist).values({ raceId: race.id, riderId: rider.id, teamId: team.id });
        inserted++;
        console.log(`  ✅ ${r.name}`);
      } else {
        skipped++;
      }
    } catch (e: any) {
      console.error(`  ❌ ${r.name}: ${e.message}`);
    }
  }
  console.log(`\nDone: ${inserted} inserted, ${skipped} already existed`);
}

main().catch(console.error);
