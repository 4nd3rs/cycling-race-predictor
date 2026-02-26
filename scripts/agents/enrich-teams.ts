/**
 * enrich-teams.ts
 * Enriches WorldTour/ProTeam road teams with slug, website, twitter, instagram.
 * Run: tsx scripts/agents/enrich-teams.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, ilike, or } from "drizzle-orm";
import { teams } from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface TeamData {
  match: (name: string) => boolean;
  slug: string;
  website?: string;
  twitter?: string;
  instagram?: string;
  logoUrl?: string;
}

const CURATED: TeamData[] = [
  {
    match: (n) => /UAE\s*Team\s*Emirates/i.test(n),
    slug: "uae-team-emirates",
    website: "https://www.uaeteamemirates.com",
    twitter: "https://twitter.com/uaeteamemirates",
    instagram: "https://www.instagram.com/uaeteamemirates/",
  },
  {
    match: (n) => /Visma|Jumbo/i.test(n),
    slug: "team-visma-lease-a-bike",
    website: "https://www.teamvismaleaseabike.com",
    twitter: "https://twitter.com/teamvisma",
    instagram: "https://www.instagram.com/teamvisma/",
  },
  {
    match: (n) => /INEOS|Ineos/i.test(n),
    slug: "ineos-grenadiers",
    website: "https://www.ineos.com/initiatives/grenadiers/",
    twitter: "https://twitter.com/INEOSGrenadiers",
    instagram: "https://www.instagram.com/ineos.grenadiers/",
  },
  {
    match: (n) => /Alpecin/i.test(n),
    slug: "alpecin-deceuninck",
    website: "https://www.alpecin.com/en/cycling",
    twitter: "https://twitter.com/alpecin_dcnk",
    instagram: "https://www.instagram.com/alpecin_deceuninck/",
  },
  {
    match: (n) => /Soudal|Quick.?Step/i.test(n),
    slug: "soudal-quick-step",
    website: "https://www.soudal-quickstep.com",
    twitter: "https://twitter.com/soudalquickstep",
    instagram: "https://www.instagram.com/soudalquickstep/",
  },
  {
    match: (n) => /Lidl.*Trek|Trek.*Lidl/i.test(n),
    slug: "lidl-trek",
    website: "https://www.trekfactoryracing.com",
    twitter: "https://twitter.com/TrekFactory",
    instagram: "https://www.instagram.com/trekfactoryracing/",
  },
  {
    match: (n) => /EF\s*(Education|Pro)/i.test(n),
    slug: "ef-education-easypost",
    website: "https://efprocycling.com",
    twitter: "https://twitter.com/EFprocycling",
    instagram: "https://www.instagram.com/efprocycling/",
  },
  {
    match: (n) => /Red Bull.*BORA|BORA.*hansgrohe/i.test(n),
    slug: "red-bull-bora-hansgrohe",
    website: "https://www.borahansgrohe.de",
    twitter: "https://twitter.com/borahansgrohe",
    instagram: "https://www.instagram.com/borahansgrohe/",
  },
  {
    match: (n) => /Groupama.*FDJ|FDJ.*United/i.test(n),
    slug: "groupama-fdj",
    website: "https://www.groupama-fdj.com",
    twitter: "https://twitter.com/GroupamaFDJ",
    instagram: "https://www.instagram.com/groupama_fdj/",
  },
  {
    match: (n) => /^Cofidis/i.test(n),
    slug: "cofidis",
    website: "https://www.cofidis.com",
    twitter: "https://twitter.com/CofidisTeam",
    instagram: "https://www.instagram.com/cofidis_officiel/",
  },
  {
    match: (n) => /Bahrain/i.test(n),
    slug: "bahrain-victorious",
    website: "https://www.bahraincyclingteam.com",
    twitter: "https://twitter.com/BahTMVictorious",
    instagram: "https://www.instagram.com/bahrain_victorious/",
  },
  {
    match: (n) => /Jayco|AlUla/i.test(n),
    slug: "team-jayco-alula",
    website: "https://www.teamjaycoalula.com",
    twitter: "https://twitter.com/TeamJaycoAlUla",
    instagram: "https://www.instagram.com/teamjaycoalula/",
  },
  {
    match: (n) => /Movistar/i.test(n),
    slug: "movistar-team",
    website: "https://www.movistarteam.com",
    twitter: "https://twitter.com/Movistar_Team",
    instagram: "https://www.instagram.com/movistar_team/",
  },
  {
    match: (n) => /Lotto.*Intermarché|Lotto.*Dstny|Lotto.*DKB/i.test(n),
    slug: "lotto-dstny",
    website: "https://www.lottodstny.be",
    twitter: "https://twitter.com/lotto_dstny",
    instagram: "https://www.instagram.com/lottodstny/",
  },
  {
    match: (n) => /Decathlon|AG2R|CMA.*CGM/i.test(n),
    slug: "decathlon-ag2r",
    website: "https://www.decathlon-ag2rlamondiale.fr",
    twitter: "https://twitter.com/AG2RLaMondialeT",
    instagram: "https://www.instagram.com/ag2rlamondialeteam/",
  },
  {
    match: (n) => /Tudor/i.test(n),
    slug: "tudor-pro-cycling",
    website: "https://www.tudor.com",
    twitter: "https://twitter.com/TudorProCycling",
    instagram: "https://www.instagram.com/tudorprocycling/",
  },
  {
    match: (n) => /Uno.?X/i.test(n),
    slug: "uno-x-mobility",
    website: "https://www.unox.com",
    twitter: "https://twitter.com/UnoXproteam",
    instagram: "https://www.instagram.com/unoxproteam/",
  },
  {
    match: (n) => /Astana/i.test(n),
    slug: "astana-qazaqstan",
    website: "https://www.astana.kz",
    twitter: "https://twitter.com/AstanaQazaqstan",
    instagram: "https://www.instagram.com/astanaqazaqstanteam/",
  },
  {
    match: (n) => /Intermarché|Circus.*Wanty|Wanty/i.test(n),
    slug: "intermarch-wanty",
    website: "https://www.intermarche-circus-wanty.com",
    twitter: "https://twitter.com/iCWcycling",
    instagram: "https://www.instagram.com/icwcycling/",
  },
  {
    match: (n) => /Pinarello|Q36\.?5/i.test(n),
    slug: "pinarello-q365",
    website: "https://www.q365.cc",
    twitter: "https://twitter.com/q365procycling",
    instagram: "https://www.instagram.com/q365procycling/",
  },
  {
    match: (n) => /TotalEnergies/i.test(n),
    slug: "totalenergies",
    website: "https://www.totalenergies.com",
    twitter: "https://twitter.com/TotalEnergiesPC",
    instagram: "https://www.instagram.com/totalenergies_cycling/",
  },
  {
    match: (n) => /Arkéa|Arkea|B&B/i.test(n),
    slug: "arkea-b-and-b",
    website: "https://www.equipe-arkea-samsic.fr",
    twitter: "https://twitter.com/Arkea_Samsic",
    instagram: "https://www.instagram.com/arkeabbhotels/",
  },
  {
    match: (n) => /Flanders.*Baloise|Baloise.*Flanders/i.test(n),
    slug: "team-flanders-baloise",
    website: "https://www.teamflandersbaloise.be",
    twitter: "https://twitter.com/Teamflandersbal",
    instagram: "https://www.instagram.com/teamflandersbaloise/",
  },
  {
    match: (n) => /Israel.*Premier|Premier.*Tech/i.test(n),
    slug: "israel-premier-tech",
    website: "https://www.ipct.cc",
    twitter: "https://twitter.com/IsraelPremTech",
    instagram: "https://www.instagram.com/israelpremiertech/",
  },
  {
    match: (n) => /Burgos|Burpellet/i.test(n),
    slug: "burgos-bh",
    website: "https://www.burgosbh.com",
    twitter: "https://twitter.com/burgosbh",
    instagram: "https://www.instagram.com/burgosbh/",
  },
  {
    match: (n) => /NSN|Human Powered/i.test(n),
    slug: "nsn-cycling",
    website: "https://www.nsnracing.com",
    twitter: "https://twitter.com/NSNracing",
    instagram: "https://www.instagram.com/nsnracing/",
  },
  {
    match: (n) => /Picnic|PostNL/i.test(n),
    slug: "team-picnic-postnl",
    website: "https://www.teampicnicpostnl.com",
    twitter: "https://twitter.com/TeamPicnicNL",
    instagram: "https://www.instagram.com/teampicnicpostnl/",
  },
];

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

async function main() {
  console.log("\n🏊 Team Enrichment\n");
  const allTeams = await db.select().from(teams);
  console.log(`Found ${allTeams.length} teams in DB`);

  let updated = 0;
  let skipped = 0;
  let sluggedOnly = 0;

  for (const team of allTeams) {
    const curated = CURATED.find((c) => c.match(team.name));

    if (curated) {
      try {
        await db
          .update(teams)
          .set({
            slug: curated.slug,
            website: curated.website || team.website,
            twitter: curated.twitter || team.twitter,
            instagram: curated.instagram || team.instagram,
          })
          .where(eq(teams.id, team.id));
        console.log(`  ✅ ${team.name} → ${curated.slug}`);
        updated++;
      } catch {
        // slug already taken by another team record — update only the social fields
        await db
          .update(teams)
          .set({
            website: curated.website || team.website,
            twitter: curated.twitter || team.twitter,
            instagram: curated.instagram || team.instagram,
          })
          .where(eq(teams.id, team.id));
        console.log(`  ⚠️ ${team.name} — slug conflict, updated socials only`);
        updated++;
      }
    } else if (!team.slug) {
      // Auto-generate slug from name (strip division suffix like "(WT)")
      try {
        const cleanName = team.name.replace(/\s*\(.*?\)\s*$/, "").trim();
        const autoSlug = toSlug(cleanName);
        await db
          .update(teams)
          .set({ slug: autoSlug })
          .where(eq(teams.id, team.id));
        sluggedOnly++;
      } catch {
        // ignore unique constraint violations for auto-slugged teams
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ Done. Updated: ${updated}, Auto-slugged: ${sluggedOnly}, Skipped: ${skipped}`);
}

main().catch(console.error);
