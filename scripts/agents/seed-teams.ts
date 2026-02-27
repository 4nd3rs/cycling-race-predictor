/**
 * seed-teams.ts
 * Seeds UCI WorldTour, ProTeam, Women's WorldTour, ProTeam, and selected Continental teams.
 * Run: npx tsx scripts/agents/seed-teams.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

interface Team {
  name: string;
  slug: string;
  division: string;
  country: string;
  discipline: string;
}

const TEAMS: Team[] = [
  // ──────────────────────────────────────────────
  // UCI WorldTour 2026
  // ──────────────────────────────────────────────
  { name: "Alpecin-Deceuninck", slug: "alpecin-deceuninck", division: "WorldTour", country: "BEL", discipline: "road" },
  { name: "Astana Qazaqstan", slug: "astana-qazaqstan-team", division: "WorldTour", country: "KAZ", discipline: "road" },
  { name: "Bahrain Victorious", slug: "bahrain-victorious", division: "WorldTour", country: "BHR", discipline: "road" },
  { name: "Decathlon AG2R La Mondiale", slug: "decathlon-ag2r-la-mondiale-team", division: "WorldTour", country: "FRA", discipline: "road" },
  { name: "EF Education-EasyPost", slug: "ef-education-easypost", division: "WorldTour", country: "USA", discipline: "road" },
  { name: "Groupama-FDJ", slug: "groupama-fdj", division: "WorldTour", country: "FRA", discipline: "road" },
  { name: "Ineos Grenadiers", slug: "ineos-grenadiers", division: "WorldTour", country: "GBR", discipline: "road" },
  { name: "Intermarché-Wanty", slug: "intermarche-wanty", division: "WorldTour", country: "BEL", discipline: "road" },
  { name: "Israel-Premier Tech", slug: "israel-premier-tech", division: "WorldTour", country: "ISR", discipline: "road" },
  { name: "Jayco AlUla", slug: "jayco-alula", division: "WorldTour", country: "AUS", discipline: "road" },
  { name: "Lidl-Trek", slug: "lidl-trek", division: "WorldTour", country: "USA", discipline: "road" },
  { name: "Movistar Team", slug: "movistar-team", division: "WorldTour", country: "ESP", discipline: "road" },
  { name: "Red Bull-Bora-Hansgrohe", slug: "red-bull-bora-hansgrohe", division: "WorldTour", country: "GER", discipline: "road" },
  { name: "Soudal Quick-Step", slug: "soudal-quick-step", division: "WorldTour", country: "BEL", discipline: "road" },
  { name: "Tudor Pro Cycling", slug: "tudor-pro-cycling-team", division: "WorldTour", country: "CHE", discipline: "road" },
  { name: "UAE Team Emirates", slug: "uae-team-emirates", division: "WorldTour", country: "UAE", discipline: "road" },
  { name: "Visma-Lease a Bike", slug: "team-visma-lease-a-bike", division: "WorldTour", country: "NLD", discipline: "road" },
  { name: "XDS Astana", slug: "xds-astana-team", division: "WorldTour", country: "CHN", discipline: "road" },
  // ──────────────────────────────────────────────
  // UCI ProTeam 2026
  // ──────────────────────────────────────────────
  { name: "Arkéa-B&B Hotels", slug: "arkea-b-b-hotels", division: "ProTeam", country: "FRA", discipline: "road" },
  { name: "Cofidis", slug: "cofidis", division: "ProTeam", country: "FRA", discipline: "road" },
  { name: "DSM-Firmenich PostNL", slug: "dsm-firmenich-postnl", division: "ProTeam", country: "NLD", discipline: "road" },
  { name: "Q36.5 Pro Cycling Team", slug: "q365-pro-cycling-team", division: "ProTeam", country: "CHE", discipline: "road" },
  { name: "TotalEnergies", slug: "totalenergies", division: "ProTeam", country: "FRA", discipline: "road" },
  { name: "Uno-X Mobility", slug: "uno-x-mobility", division: "ProTeam", country: "NOR", discipline: "road" },
  // ──────────────────────────────────────────────
  // Women's WorldTour 2026
  // ──────────────────────────────────────────────
  { name: "AG Insurance-Soudal", slug: "ag-insurance-soudal-team", division: "Women's WorldTour", country: "BEL", discipline: "road" },
  { name: "FDJ-Suez", slug: "fdj-suez", division: "Women's WorldTour", country: "FRA", discipline: "road" },
  { name: "Fenix-Deceuninck", slug: "fenix-deceuninck", division: "Women's WorldTour", country: "BEL", discipline: "road" },
  { name: "Human Powered Health", slug: "human-powered-health", division: "Women's WorldTour", country: "USA", discipline: "road" },
  { name: "Lidl-Trek Women", slug: "lidl-trek-women", division: "Women's WorldTour", country: "USA", discipline: "road" },
  { name: "Movistar Team Women", slug: "movistar-team-women", division: "Women's WorldTour", country: "ESP", discipline: "road" },
  { name: "SD Worx-Protime", slug: "sd-worx-protime", division: "Women's WorldTour", country: "BEL", discipline: "road" },
  { name: "Team Visma-Lease a Bike Women", slug: "team-visma-lease-a-bike-women", division: "Women's WorldTour", country: "NLD", discipline: "road" },
  { name: "UAE Team ADQ", slug: "uae-team-adq", division: "Women's WorldTour", country: "UAE", discipline: "road" },
  { name: "Uno-X Mobility Women", slug: "uno-x-mobility-women", division: "Women's WorldTour", country: "NOR", discipline: "road" },
  // ──────────────────────────────────────────────
  // Selected Continental Teams (Scandinavian focus + others)
  // ──────────────────────────────────────────────
  { name: "Lucky Sport Cycling Team", slug: "lucky-sport-cycling-team", division: "Continental", country: "SWE", discipline: "road" },
  { name: "Coop-Repsol", slug: "coop-repsol", division: "Continental", country: "NOR", discipline: "road" },
  { name: "Human Powered Health Men", slug: "human-powered-health-men", division: "Continental", country: "USA", discipline: "road" },
  { name: "EvoPro Racing", slug: "evopro-racing", division: "Continental", country: "IRL", discipline: "road" },
  { name: "Tarteletto-Isorex", slug: "tarteletto-isorex", division: "Continental", country: "BEL", discipline: "road" },
  { name: "Rally Cycling", slug: "rally-cycling", division: "Continental", country: "USA", discipline: "road" },
  { name: "Nippo-Delko One Provence", slug: "nippo-delko-one-provence", division: "Continental", country: "FRA", discipline: "road" },
  { name: "Bolton Equities Black Spoke", slug: "bolton-equities-black-spoke", division: "Continental", country: "NZL", discipline: "road" },
  // ──────────────────────────────────────────────
  // MTB World Cup Teams
  // ──────────────────────────────────────────────
  { name: "Canyon CLLCTV XCO", slug: "canyon-cllctv-xco", division: "UCI MTB Team", country: "GER", discipline: "mtb" },
  { name: "BMC MTB Racing", slug: "bmc-mtb-racing", division: "UCI MTB Team", country: "CHE", discipline: "mtb" },
  { name: "Specialized Factory Racing", slug: "specialized-factory-racing", division: "UCI MTB Team", country: "USA", discipline: "mtb" },
  { name: "Trek Factory Racing XC", slug: "trek-factory-racing-xc", division: "UCI MTB Team", country: "USA", discipline: "mtb" },
  { name: "Orbea Factory Team", slug: "orbea-factory-team", division: "UCI MTB Team", country: "ESP", discipline: "mtb" },
  { name: "Cannondale Factory Racing", slug: "cannondale-factory-racing", division: "UCI MTB Team", country: "USA", discipline: "mtb" },
  { name: "Alpecin-Fenix MTB", slug: "alpecin-fenix-mtb", division: "UCI MTB Team", country: "BEL", discipline: "mtb" },
  { name: "Rockrider Racing Team", slug: "rockrider-racing-team", division: "UCI MTB Team", country: "FRA", discipline: "mtb" },
  { name: "Mondraker Factory Racing", slug: "mondraker-factory-racing", division: "UCI MTB Team", country: "ESP", discipline: "mtb" },
];

async function main() {
  let inserted = 0, updated = 0;
  for (const team of TEAMS) {
    const existing = await db.query.teams.findFirst({
      where: eq(schema.teams.slug, team.slug),
    });
    if (existing) {
      await db.update(schema.teams).set({
        name: team.name,
        division: team.division,
        country: team.country,
        discipline: team.discipline,
      }).where(eq(schema.teams.id, existing.id));
      updated++;
    } else {
      await db.insert(schema.teams).values(team);
      console.log(`+ ${team.name} [${team.division}]`);
      inserted++;
    }
  }
  console.log(`\nDone: ${inserted} inserted, ${updated} updated`);
}
main().catch(console.error);
