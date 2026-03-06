import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { db, races, raceResults, raceEvents, marketingPosts } from "./lib/db";
import { eq as eqOp } from "drizzle-orm";
import { and, gte, lte, eq, sql } from "drizzle-orm";

const INTEL_DIR = "./data/intel";

interface IntelItem {
  type: "rider" | "race";
  subject: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  sentiment?: number;
  tags: string[];
}

function loadTodayIntel(): IntelItem[] {
  const today = new Date().toISOString().slice(0, 10);
  const file = `${INTEL_DIR}/${today}.jsonl`;
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

function getIntelForRace(raceName: string, intel: IntelItem[]): IntelItem[] {
  const lower = raceName.toLowerCase();
  return intel.filter((i) => i.type === "race" && i.subject.toLowerCase().includes(lower.split(" ")[0]));
}

// ─── DB-backed tracking ───────────────────────────────────────────────────────

async function hasPosted(raceId: string, postType: string, channel: string): Promise<boolean> {
  const rows = await db
    .select({ id: marketingPosts.id })
    .from(marketingPosts)
    .where(
      and(
        eq(marketingPosts.raceId, raceId),
        eq(marketingPosts.postType, postType),
        eq(marketingPosts.channel, channel)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function markPosted(raceId: string, postType: string, channel: string): Promise<void> {
  await db
    .insert(marketingPosts)
    .values({ raceId, postType, channel })
    .onConflictDoNothing();
}


const EUROPEAN_COUNTRIES = new Set([
  "BEL","FRA","ITA","ESP","NED","GER","GBR","SUI","AUT","POR","NOR","SWE","DEN","FIN",
  "POL","CZE","SVK","HUN","ROU","BUL","SRB","CRO","SLO","EST","LAT","LTU","UKR","GRE",
  "TUR","LUX","IRL","RSM","MCO","AND","MNE","BIH","ALB","MKD","MDA","BLR","RUS","GEO",
  // common UCI 3-letter codes too
  "NL","DE","FR","IT","ES","BE","GB","CH","AT","NO","SE","DK","FI","PT","PL","CZ","HU",
  "RO","BG","RS","HR","SI","EE","LV","LT","UA","GR","TR","LU","IE","SM","MC","AD"
]);

async function getEventSlug(race: typeof races.$inferSelect): Promise<string | null> {
  if (!race.raceEventId) return null;
  try {
    const [event] = await db.select({ slug: raceEvents.slug }).from(raceEvents).where(eqOp(raceEvents.id, race.raceEventId)).limit(1);
    return event?.slug ?? null;
  } catch { return null; }
}

// Only post Instagram stories for elite road/mtb WorldCup races (skip junior/u23 series)
function shouldPostToInstagram(race: { name: string; discipline?: string | null; categorySlug?: string | null; uciCategory?: string | null; country?: string | null }): boolean {
  const country = (race.country || "").toUpperCase();
  const isMtb = (race.discipline || "").toLowerCase() === "mtb";

  // MTB: European races only (all UCI classes)
  if (isMtb) {
    return EUROPEAN_COUNTRIES.has(country);
  }

  // Road: all UCI classes, all countries
  return true;
}

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function enrichRidersForRace(raceId: string): Promise<void> {
  console.log(`  🎽 Enriching rider photos for race ${raceId}...`);
  try {
    execSync(
      `node_modules/.bin/tsx scripts/agents/scrape-rider-profiles.ts --race ${raceId} --limit 30`,
      { encoding: "utf-8", stdio: "pipe", cwd: process.cwd(), timeout: 120000 }
    );
    console.log(`  ✅ Rider enrichment done`);
  } catch (err) {
    console.warn(`  ⚠️ Rider enrichment failed (non-critical):`, (err as any)?.message?.slice(0, 100));
  }
}

async function main() {
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || !channel) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID must be set");
    process.exit(1);
  }

  let postsCount = 0;
  const latestIntel = loadTodayIntel();
  if (latestIntel.length > 0) console.log(`📡 Loaded ${latestIntel.length} intel items for today`);

  // ─── 1. PREVIEW: Upcoming races in next 3 days ───────────────
  const today = dayStr(0);
  const threeDaysOut = dayStr(3);

  console.log(`\n🔍 Looking for upcoming races between ${today} and ${threeDaysOut}...\n`);

  // Fetch races joined with event for country + discipline
  const upcomingRacesRaw = await db
    .select()
    .from(races)
    .where(
      and(
        gte(races.date, today),
        lte(races.date, threeDaysOut),
        eq(races.status, "active")
      )
    )
    .orderBy(races.date);

  // Enrich with event country/discipline via slug lookup
  const upcomingRaces = await Promise.all(upcomingRacesRaw.map(async (race) => {
    if (!race.raceEventId) return { ...race, country: null };
    try {
      const [ev] = await db.select({ country: raceEvents.country, discipline: raceEvents.discipline })
        .from(raceEvents).where(eqOp(raceEvents.id, race.raceEventId)).limit(1);
      return { ...race, country: ev?.country ?? null, discipline: ev?.discipline ?? race.discipline };
    } catch { return { ...race, country: null }; }
  }));

  for (const race of upcomingRaces) {
    if (await hasPosted(race.id, "preview", "telegram")) {
      console.log(`⏭️  Already posted preview: ${race.name}`);
      continue;
    }

    console.log(`📸 Posting preview: ${race.name} (${race.date})`);
    try {
      execSync(
        `node_modules/.bin/tsx scripts/agents/post-to-telegram.ts --race-id ${race.id} --type preview --channel "${channel}"`,
        { encoding: "utf-8", stdio: "inherit", cwd: process.cwd() }
      );
      await markPosted(race.id, "preview", "telegram");
      postsCount++;
      console.log(`✅ Preview posted: ${race.name}\n`);
    } catch (err) {
      console.error(`❌ Failed to post preview for ${race.name}:`, err);
    }

    // Instagram Stories — enrich rider photos first, then post
    const igPreviewSlug = await getEventSlug(race);
    if (igPreviewSlug && shouldPostToInstagram(race) && !(await hasPosted(race.id, "ig-preview", "instagram"))) {
      await enrichRidersForRace(race.id);
      const cat = (race.categorySlug || "").toLowerCase();
      const genders: string[] = cat.includes("women") ? ["women"] : cat.includes("men") ? ["men"] : ["men", "women"];
      for (const gender of genders) {
        console.log(`📸 Posting Instagram Story preview (${gender}): ${race.name}`);
        try {
          execSync(
            `node_modules/.bin/tsx scripts/agents/post-to-instagram.ts --event ${igPreviewSlug} --type preview --gender ${gender}`,
            { encoding: "utf-8", stdio: "inherit", cwd: process.cwd(), timeout: 120000 }
          );
          console.log(`✅ Instagram Story preview (${gender}) posted: ${race.name}\n`);
        } catch (err) {
          console.error(`❌ Instagram Story preview (${gender}) failed for ${race.name}:`, (err as any)?.message?.slice(0, 200));
        }
        await new Promise(r => setTimeout(r, 3000)); // brief pause between posts
      }
      await markPosted(race.id, "ig-preview", "instagram");
    }
  }

  // ─── 2. RESULTS: Races completed yesterday or 2 days ago ─────
  const yesterday = dayStr(-1);
  const twoDaysAgo = dayStr(-2);

  console.log(`\n🔍 Looking for completed races from ${twoDaysAgo} to ${yesterday}...\n`);

  // Find races from the last 2 days that have results
  const completedRacesRaw = await db
    .select()
    .from(races)
    .where(
      and(
        gte(races.date, twoDaysAgo),
        lte(races.date, yesterday),
        sql`${races.id} IN (SELECT ${raceResults.raceId} FROM ${raceResults} GROUP BY ${raceResults.raceId})`
      )
    )
    .orderBy(races.date);

  const completedRaces = await Promise.all(completedRacesRaw.map(async (race) => {
    if (!race.raceEventId) return { ...race, country: null };
    try {
      const [ev] = await db.select({ country: raceEvents.country, discipline: raceEvents.discipline })
        .from(raceEvents).where(eqOp(raceEvents.id, race.raceEventId)).limit(1);
      return { ...race, country: ev?.country ?? null, discipline: ev?.discipline ?? race.discipline };
    } catch { return { ...race, country: null }; }
  }));

  for (const race of completedRaces) {
    if (await hasPosted(race.id, "result", "telegram")) {
      console.log(`⏭️  Already posted result: ${race.name}`);
      continue;
    }

    console.log(`📸 Posting result: ${race.name} (${race.date})`);
    try {
      execSync(
        `node_modules/.bin/tsx scripts/agents/post-to-telegram.ts --race-id ${race.id} --type result --channel "${channel}"`,
        { encoding: "utf-8", stdio: "inherit", cwd: process.cwd() }
      );
      await markPosted(race.id, "result", "telegram");
      postsCount++;
      console.log(`✅ Result posted: ${race.name}\n`);
    } catch (err) {
      console.error(`❌ Failed to post result for ${race.name}:`, err);
    }

    // Instagram Stories — enrich rider photos first, then post
    const igResultSlug = await getEventSlug(race);
    if (igResultSlug && shouldPostToInstagram(race) && !(await hasPosted(race.id, "ig-result", "instagram"))) {
      await enrichRidersForRace(race.id);
      const cat = (race.categorySlug || "").toLowerCase();
      const genders: string[] = cat.includes("women") ? ["women"] : cat.includes("men") ? ["men"] : ["men", "women"];
      for (const gender of genders) {
        console.log(`📸 Posting Instagram Story result (${gender}): ${race.name}`);
        try {
          execSync(
            `node_modules/.bin/tsx scripts/agents/post-to-instagram.ts --event ${igResultSlug} --type results --gender ${gender}`,
            { encoding: "utf-8", stdio: "inherit", cwd: process.cwd(), timeout: 120000 }
          );
          console.log(`✅ Instagram Story result (${gender}) posted: ${race.name}\n`);
        } catch (err) {
          console.error(`❌ Instagram Story result (${gender}) failed for ${race.name}:`, (err as any)?.message?.slice(0, 200));
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      await markPosted(race.id, "ig-result", "instagram");
    }
  }

  // ─── Summary ──────────────────────────────────────────────────
  const totalPreviews = await db.select({ count: sql<number>`count(*)` }).from(marketingPosts).where(eq(marketingPosts.postType, "preview"));
  const totalResults = await db.select({ count: sql<number>`count(*)` }).from(marketingPosts).where(eq(marketingPosts.postType, "result"));
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Marketing Agent Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Upcoming races found: ${upcomingRaces.length}`);
  console.log(`   Completed races found: ${completedRaces.length}`);
  console.log(`   Posts made this run: ${postsCount}`);
  console.log(`   Total previews posted (all time): ${totalPreviews[0]?.count ?? 0}`);
  console.log(`   Total results posted (all time): ${totalResults[0]?.count ?? 0}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
