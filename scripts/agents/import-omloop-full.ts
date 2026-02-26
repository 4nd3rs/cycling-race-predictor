import { config } from "dotenv";
config({ path: "/Users/amalabs/cycling-race-predictor/.env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, ilike } from "drizzle-orm";
import * as schema from "/Users/amalabs/cycling-race-predictor/src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const STARTLIST: Array<{ name: string; team: string; nat?: string }> = [
  // Decathlon CMA CGM Team
  { name: "Tiesj Benoot", team: "Decathlon CMA CGM Team", nat: "BEL" },
  { name: "Stefan Bissegger", team: "Decathlon CMA CGM Team", nat: "SUI" },
  { name: "Oscar Chamberlain", team: "Decathlon CMA CGM Team", nat: "GBR" },
  { name: "Stan Dewulf", team: "Decathlon CMA CGM Team", nat: "BEL" },
  { name: "Oliver Naesen", team: "Decathlon CMA CGM Team", nat: "BEL" },
  { name: "Rasmus Søjberg Pedersen", team: "Decathlon CMA CGM Team", nat: "DEN" },
  { name: "Sander De Pestel", team: "Decathlon CMA CGM Team", nat: "BEL" },
  // Red Bull - BORA - hansgrohe
  { name: "Mick van Dijke", team: "Red Bull - BORA - hansgrohe", nat: "NED" },
  { name: "Tim van Dijke", team: "Red Bull - BORA - hansgrohe", nat: "NED" },
  { name: "Jarrad Drizners", team: "Red Bull - BORA - hansgrohe", nat: "AUS" },
  { name: "Jordi Meeus", team: "Red Bull - BORA - hansgrohe", nat: "BEL" },
  { name: "Laurence Pithie", team: "Red Bull - BORA - hansgrohe", nat: "NZL" },
  { name: "Danny van Poppel", team: "Red Bull - BORA - hansgrohe", nat: "NED" },
  { name: "Gianni Vermeersch", team: "Red Bull - BORA - hansgrohe", nat: "BEL" },
  // Tudor Pro Cycling
  { name: "Marco Haller", team: "Tudor Pro Cycling Team", nat: "AUT" },
  { name: "Petr Kelemen", team: "Tudor Pro Cycling Team", nat: "CZE" },
  { name: "Stefan Küng", team: "Tudor Pro Cycling Team", nat: "SUI" },
  { name: "Aivaras Mikutis", team: "Tudor Pro Cycling Team", nat: "LTU" },
  { name: "Luca Mozzato", team: "Tudor Pro Cycling Team", nat: "ITA" },
  { name: "Rick Pluimers", team: "Tudor Pro Cycling Team", nat: "NED" },
  { name: "Matteo Trentin", team: "Tudor Pro Cycling Team", nat: "ITA" },
  // Bahrain Victorious
  { name: "Kamil Gradek", team: "Bahrain Victorious", nat: "POL" },
  { name: "Vlad Van Mechelen", team: "Bahrain Victorious", nat: "BEL" },
  { name: "Fran Miholjević", team: "Bahrain Victorious", nat: "CRO" },
  { name: "Pau Miquel", team: "Bahrain Victorious", nat: "ESP" },
  { name: "Matej Mohorič", team: "Bahrain Victorious", nat: "SLO" },
  { name: "Alec Segaert", team: "Bahrain Victorious", nat: "BEL" },
  { name: "Attila Valter", team: "Bahrain Victorious", nat: "HUN" },
  // Uno-X Mobility
  { name: "Jonas Abrahamsen", team: "Uno-X Mobility", nat: "NOR" },
  { name: "Carl-Frederik Bévort", team: "Uno-X Mobility", nat: "DEN" },
  { name: "Sven Erik Bystrøm", team: "Uno-X Mobility", nat: "NOR" },
  { name: "Markus Hoelgaard", team: "Uno-X Mobility", nat: "NOR" },
  { name: "Erik Resell", team: "Uno-X Mobility", nat: "NOR" },
  { name: "Rasmus Tiller", team: "Uno-X Mobility", nat: "NOR" },
  { name: "Søren Wærenskjold", team: "Uno-X Mobility", nat: "NOR" },
  // NSN Cycling Team
  { name: "Tom Van Asbroeck", team: "NSN Cycling Team", nat: "BEL" },
  { name: "Lewis Askey", team: "NSN Cycling Team", nat: "GBR" },
  { name: "Guillaume Boivin", team: "NSN Cycling Team", nat: "CAN" },
  { name: "Biniam Girmay", team: "NSN Cycling Team", nat: "ERI" },
  { name: "Matîs Louvel", team: "NSN Cycling Team", nat: "FRA" },
  { name: "Ryan Mullen", team: "NSN Cycling Team", nat: "IRL" },
  { name: "Riley Sheehan", team: "NSN Cycling Team", nat: "USA" },
  // Q36.5 Pro Cycling Team
  { name: "Frederik Frison", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "BEL" },
  { name: "Aimé De Gendt", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "BEL" },
  { name: "Xandro Meurisse", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "BEL" },
  { name: "Brent Van Moer", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "BEL" },
  { name: "Tom Pidcock", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "GBR" },
  { name: "Fred Wright", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "GBR" },
  { name: "Nick Zukowsky", team: "Pinarello - Q36.5 Pro Cycling Team", nat: "CAN" },
  // Lidl-Trek
  { name: "Søren Kragh Andersen", team: "Lidl - Trek", nat: "DEN" },
  { name: "Toms Skujiņš", team: "Lidl - Trek", nat: "LAT" },
  { name: "Jakob Söderqvist", team: "Lidl - Trek", nat: "SWE" },
  { name: "Tim Torn Teutenberg", team: "Lidl - Trek", nat: "GER" },
  { name: "Edward Theuns", team: "Lidl - Trek", nat: "BEL" },
  { name: "Mathias Vacek", team: "Lidl - Trek", nat: "CZE" },
  { name: "Otto Vergaerde", team: "Lidl - Trek", nat: "BEL" },
  // Alpecin-Premier Tech
  { name: "Tobias Bayer", team: "Alpecin-Premier Tech", nat: "AUT" },
  { name: "Lennert Belmans", team: "Alpecin-Premier Tech", nat: "BEL" },
  { name: "Jonas Geens", team: "Alpecin-Premier Tech", nat: "BEL" },
  { name: "Kaden Groves", team: "Alpecin-Premier Tech", nat: "AUS" },
  { name: "Jasper Philipsen", team: "Alpecin-Premier Tech", nat: "BEL" },
  { name: "Edward Planckaert", team: "Alpecin-Premier Tech", nat: "BEL" },
  { name: "Oscar Riesebeek", team: "Alpecin-Premier Tech", nat: "NED" },
  { name: "Florian Sénéchal", team: "Alpecin-Premier Tech", nat: "FRA" },
  { name: "Mathieu van der Poel", team: "Alpecin-Premier Tech", nat: "NED" },
  // Jayco AlUla
  { name: "Dries De Bondt", team: "Team Jayco AlUla", nat: "BEL" },
  { name: "Amaury Capiot", team: "Team Jayco AlUla", nat: "BEL" },
  { name: "Robert Donaldson", team: "Team Jayco AlUla", nat: "GBR" },
  { name: "Anders Foldager", team: "Team Jayco AlUla", nat: "DEN" },
  { name: "Jelte Krijnsen", team: "Team Jayco AlUla", nat: "NED" },
  { name: "Kelland O'Brien", team: "Team Jayco AlUla", nat: "AUS" },
  { name: "Dries De Pooter", team: "Team Jayco AlUla", nat: "BEL" },
  // Burgos BH
  { name: "Clément Alleno", team: "Burgos Burpellet BH", nat: "FRA" },
  { name: "Rodrigo Alvarez", team: "Burgos Burpellet BH", nat: "ESP" },
  { name: "Daniel Cavia", team: "Burgos Burpellet BH", nat: "ESP" },
  { name: "Hugo De La Calle", team: "Burgos Burpellet BH", nat: "ESP" },
  { name: "Eric Fagúndez", team: "Burgos Burpellet BH", nat: "ESP" },
  { name: "Vojtěch Kmínek", team: "Burgos Burpellet BH", nat: "CZE" },
  { name: "César Macías", team: "Burgos Burpellet BH", nat: "ESP" },
  // INEOS Grenadiers
  { name: "Kim Heiduk", team: "INEOS Grenadiers", nat: "GER" },
  { name: "Michal Kwiatkowski", team: "INEOS Grenadiers", nat: "POL" },
  { name: "Magnus Sheffield", team: "INEOS Grenadiers", nat: "USA" },
  { name: "Artem Shmidt", team: "INEOS Grenadiers", nat: "KAZ" },
  { name: "Ben Swift", team: "INEOS Grenadiers", nat: "GBR" },
  { name: "Ben Turner", team: "INEOS Grenadiers", nat: "GBR" },
  { name: "Sam Watson", team: "INEOS Grenadiers", nat: "GBR" },
  // Team Flanders-Baloise
  { name: "Siebe Deweirdt", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Vincent Van Hemelen", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Michiel Lambrecht", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Milan Lanhove", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Elias Maris", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Dylan Vandenstorme", team: "Team Flanders - Baloise", nat: "BEL" },
  { name: "Ward Vanhoof", team: "Team Flanders - Baloise", nat: "BEL" },
  // XDS Astana
  { name: "Davide Ballerini", team: "XDS Astana Team", nat: "ITA" },
  { name: "Alberto Bettiol", team: "XDS Astana Team", nat: "ITA" },
  { name: "Yevgeniy Fedorov", team: "XDS Astana Team", nat: "KAZ" },
  { name: "Aaron Gate", team: "XDS Astana Team", nat: "NZL" },
  { name: "Arjen Livyns", team: "XDS Astana Team", nat: "BEL" },
  { name: "Alessandro Romele", team: "XDS Astana Team", nat: "ITA" },
  { name: "Mike Teunissen", team: "XDS Astana Team", nat: "NED" },
  // EF Education-EasyPost
  { name: "Vincenzo Albanese", team: "EF Education - EasyPost", nat: "ITA" },
  { name: "Kasper Asgreen", team: "EF Education - EasyPost", nat: "DEN" },
  { name: "Marijn van den Berg", team: "EF Education - EasyPost", nat: "NED" },
  { name: "Noah Hobbs", team: "EF Education - EasyPost", nat: "GBR" },
  { name: "Mikkel Honoré", team: "EF Education - EasyPost", nat: "DEN" },
  { name: "Luke Lamperti", team: "EF Education - EasyPost", nat: "USA" },
  { name: "Colby Simmons", team: "EF Education - EasyPost", nat: "USA" },
  // Team Picnic PostNL
  { name: "Julius van den Berg", team: "Team Picnic PostNL", nat: "NED" },
  { name: "Frank van den Broek", team: "Team Picnic PostNL", nat: "NED" },
  { name: "John Degenkolb", team: "Team Picnic PostNL", nat: "GER" },
  { name: "Sean Flynn", team: "Team Picnic PostNL", nat: "USA" },
  { name: "Henri-François Haquin", team: "Team Picnic PostNL", nat: "FRA" },
  { name: "Timo de Jong", team: "Team Picnic PostNL", nat: "NED" },
  { name: "Timo Roosen", team: "Team Picnic PostNL", nat: "NED" },
  // Lotto Intermarché
  { name: "Huub Artz", team: "Lotto - Intermarché", nat: "NED" },
  { name: "Jenno Berckmoes", team: "Lotto - Intermarché", nat: "BEL" },
  { name: "Cedric Beullens", team: "Lotto - Intermarché", nat: "BEL" },
  { name: "Luca Van Boven", team: "Lotto - Intermarché", nat: "BEL" },
  { name: "Sébastien Grignard", team: "Lotto - Intermarché", nat: "BEL" },
  { name: "Arnaud De Lie", team: "Lotto - Intermarché", nat: "BEL" },
  { name: "Roel van Sintmaartensdijk", team: "Lotto - Intermarché", nat: "NED" },
  // Team Visma | Lease a Bike
  { name: "Wout van Aert", team: "Team Visma | Lease a Bike", nat: "BEL" },
  { name: "Edoardo Affini", team: "Team Visma | Lease a Bike", nat: "ITA" },
  { name: "Matthew Brennan", team: "Team Visma | Lease a Bike", nat: "GBR" },
  { name: "Per Strand Hagenes", team: "Team Visma | Lease a Bike", nat: "NOR" },
  { name: "Timo Kielich", team: "Team Visma | Lease a Bike", nat: "BEL" },
  { name: "Christophe Laporte", team: "Team Visma | Lease a Bike", nat: "FRA" },
  { name: "Axel Zingle", team: "Team Visma | Lease a Bike", nat: "FRA" },
  // Soudal Quick-Step
  { name: "Dylan van Baarle", team: "Soudal - Quick-Step", nat: "NED" },
  { name: "Dries Van Gestel", team: "Soudal - Quick-Step", nat: "BEL" },
  { name: "Yves Lampaert", team: "Soudal - Quick-Step", nat: "BEL" },
  { name: "Paul Magnier", team: "Soudal - Quick-Step", nat: "FRA" },
  { name: "Casper Pedersen", team: "Soudal - Quick-Step", nat: "DEN" },
  { name: "Laurenz Rex", team: "Soudal - Quick-Step", nat: "BEL" },
  { name: "Jasper Stuyven", team: "Soudal - Quick-Step", nat: "BEL" },
  // UAE Team Emirates XRG
  { name: "Mikkel Bjerg", team: "UAE Team Emirates XRG", nat: "DEN" },
  { name: "Rune Herregodts", team: "UAE Team Emirates XRG", nat: "BEL" },
  { name: "Rui Oliveira", team: "UAE Team Emirates XRG", nat: "POR" },
  { name: "Nils Politt", team: "UAE Team Emirates XRG", nat: "GER" },
  { name: "Florian Vermeersch", team: "UAE Team Emirates XRG", nat: "BEL" },
  { name: "Tim Wellens", team: "UAE Team Emirates XRG", nat: "BEL" },
  // Groupama FDJ United
  { name: "Cyril Barthe", team: "Groupama - FDJ United", nat: "FRA" },
  { name: "Thibaud Gruel", team: "Groupama - FDJ United", nat: "FRA" },
  { name: "Axel Huens", team: "Groupama - FDJ United", nat: "BEL" },
  { name: "Johan Jacobs", team: "Groupama - FDJ United", nat: "SUI" },
  { name: "Valentin Madouas", team: "Groupama - FDJ United", nat: "FRA" },
  { name: "Clément Russo", team: "Groupama - FDJ United", nat: "FRA" },
  { name: "Bastien Tronchon", team: "Groupama - FDJ United", nat: "FRA" },
  // Cofidis
  { name: "Piet Allegaert", team: "Cofidis", nat: "BEL" },
  { name: "Stanisław Aniołkowski", team: "Cofidis", nat: "POL" },
  { name: "Jenthe Biermans", team: "Cofidis", nat: "BEL" },
  { name: "Alex Kirsch", team: "Cofidis", nat: "LUX" },
  { name: "Hugo Page", team: "Cofidis", nat: "FRA" },
  { name: "Alexis Renard", team: "Cofidis", nat: "FRA" },
  { name: "Dylan Teuns", team: "Cofidis", nat: "BEL" },
  // Movistar Team
  { name: "Roger Adrià", team: "Movistar Team", nat: "ESP" },
  { name: "Orluis Aular", team: "Movistar Team", nat: "VEN" },
  { name: "Jon Barranetxea", team: "Movistar Team", nat: "ESP" },
  { name: "Carlos Canal", team: "Movistar Team", nat: "ESP" },
  { name: "Iván García Cortina", team: "Movistar Team", nat: "ESP" },
  { name: "Filip Maciejuk", team: "Movistar Team", nat: "POL" },
  { name: "Manlio Moro", team: "Movistar Team", nat: "ITA" },
  // TotalEnergies
  { name: "Alexys Brunel", team: "TotalEnergies", nat: "FRA" },
  { name: "Sandy Dujardin", team: "TotalEnergies", nat: "FRA" },
];

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function findOrCreateTeam(name: string) {
  const ex = await db.query.teams.findFirst({ where: ilike(schema.teams.name, name) });
  if (ex) return ex.id;
  const [c] = await db.insert(schema.teams).values({ name, discipline: "road" }).returning({ id: schema.teams.id });
  return c.id;
}

async function findOrCreateRider(name: string, teamId: string, nat: string) {
  const ex = await db.query.riders.findFirst({ where: ilike(schema.riders.name, name) });
  if (ex) {
    await db.update(schema.riders).set({ teamId, nationality: nat as any }).where(eq(schema.riders.id, ex.id));
    return ex.id;
  }
  const all = await db.select({ id: schema.riders.id, name: schema.riders.name }).from(schema.riders).limit(5000);
  const stripped = stripAccents(name);
  const match = all.find(r => stripAccents(r.name) === stripped);
  if (match) {
    await db.update(schema.riders).set({ teamId, nationality: nat as any }).where(eq(schema.riders.id, match.id));
    return match.id;
  }
  const [c] = await db.insert(schema.riders).values({ name, teamId, nationality: nat as any }).returning({ id: schema.riders.id });
  return c.id;
}

async function main() {
  const race = await db.query.races.findFirst({ where: ilike(schema.races.name, "%Omloop Het Nieuwsblad 2026%") });
  if (!race) { console.error("Race not found!"); process.exit(1); }
  console.log(`Race: ${race.name} (${race.id})`);

  let inserted = 0, skipped = 0, errors = 0;
  for (const r of STARTLIST) {
    try {
      const teamId = await findOrCreateTeam(r.team);
      const riderId = await findOrCreateRider(r.name, teamId, r.nat || "");
      const ex = await db.query.raceStartlist.findFirst({
        where: and(eq(schema.raceStartlist.raceId, race.id), eq(schema.raceStartlist.riderId, riderId))
      });
      if (!ex) {
        await db.insert(schema.raceStartlist).values({ raceId: race.id, riderId, teamId });
        inserted++;
        process.stdout.write(`✅ ${r.name}\n`);
      } else skipped++;
    } catch (e: any) { console.error(`❌ ${r.name}: ${e.message}`); errors++; }
  }
  console.log(`\nDone: ${inserted} new, ${skipped} already existed, ${errors} errors`);
  console.log(`Total startlist: ${inserted + skipped} riders`);
}
main().catch(console.error);
