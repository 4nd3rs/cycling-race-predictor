import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { db, races, raceResults, raceEvents } from "./lib/db";
import { eq as eqOp } from "drizzle-orm";
import { and, gte, lte, eq, sql } from "drizzle-orm";

import path from "path";
const TRACKING_FILE = path.join(process.cwd(), "data/marketing-posted.json");
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

interface TrackingData {
  previews: string[]; // race IDs
  results: string[];  // race IDs
  igPreviews: string[]; // Instagram story previews
  igResults: string[];  // Instagram story results
}

function loadTracking(): TrackingData {
  const defaults: TrackingData = { previews: [], results: [], igPreviews: [], igResults: [] };
  if (existsSync(TRACKING_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(TRACKING_FILE, "utf-8"));
      return { ...defaults, ...parsed };
    } catch {
      // Corrupted file, reset
    }
  }
  return defaults;
}

function saveTracking(data: TrackingData): void {
  writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
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

async function main() {
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || !channel) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID must be set");
    process.exit(1);
  }

  const tracking = loadTracking();
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
    if (tracking.previews.includes(race.id)) {
      console.log(`⏭️  Already posted preview: ${race.name}`);
      continue;
    }

    console.log(`📸 Posting preview: ${race.name} (${race.date})`);
    try {
      const intelFlag = latestIntel.length > 0 ? `--has-intel` : "";
      execSync(
        `node_modules/.bin/tsx scripts/agents/post-to-telegram.ts --race-id ${race.id} --type preview --channel "${channel}"`,
        { encoding: "utf-8", stdio: "inherit", cwd: process.cwd() }
      );
      tracking.previews.push(race.id);
      saveTracking(tracking);
      postsCount++;
      console.log(`✅ Preview posted: ${race.name}\n`);
    } catch (err) {
      console.error(`❌ Failed to post preview for ${race.name}:`, err);
    }

    // Instagram Stories — elite races only, post men + women
    const igPreviewSlug = await getEventSlug(race);
    if (igPreviewSlug && shouldPostToInstagram(race) && !tracking.igPreviews.includes(race.id)) {
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
      tracking.igPreviews.push(race.id);
      saveTracking(tracking);
    }
  }

  // ─── 2. RESULTS: Races completed yesterday ────────────────────
  const yesterday = dayStr(-1);

  console.log(`\n🔍 Looking for completed races from ${yesterday}...\n`);

  // Find races from yesterday that have results
  const completedRacesRaw = await db
    .select()
    .from(races)
    .where(
      and(
        eq(races.date, yesterday),
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
    if (tracking.results.includes(race.id)) {
      console.log(`⏭️  Already posted result: ${race.name}`);
      continue;
    }

    console.log(`📸 Posting result: ${race.name} (${race.date})`);
    try {
      execSync(
        `node_modules/.bin/tsx scripts/agents/post-to-telegram.ts --race-id ${race.id} --type result --channel "${channel}"`,
        { encoding: "utf-8", stdio: "inherit", cwd: process.cwd() }
      );
      tracking.results.push(race.id);
      saveTracking(tracking);
      postsCount++;
      console.log(`✅ Result posted: ${race.name}\n`);
    } catch (err) {
      console.error(`❌ Failed to post result for ${race.name}:`, err);
    }

    // Instagram Stories — elite races only, post men + women
    const igResultSlug = await getEventSlug(race);
    if (igResultSlug && shouldPostToInstagram(race) && !tracking.igResults.includes(race.id)) {
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
      tracking.igResults.push(race.id);
      saveTracking(tracking);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Marketing Agent Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Upcoming races found: ${upcomingRaces.length}`);
  console.log(`   Completed races found: ${completedRaces.length}`);
  console.log(`   Posts made this run: ${postsCount}`);
  console.log(`   Total previews posted: ${tracking.previews.length}`);
  console.log(`   Total results posted: ${tracking.results.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
