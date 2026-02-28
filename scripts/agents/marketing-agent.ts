import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { db, races, raceResults, raceEvents } from "./lib/db";
import { eq as eqOp } from "drizzle-orm";
import { and, gte, lte, eq, sql } from "drizzle-orm";

const TRACKING_FILE = "/tmp/marketing-posted.json";
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
  if (existsSync(TRACKING_FILE)) {
    try {
      return JSON.parse(readFileSync(TRACKING_FILE, "utf-8"));
    } catch {
      // Corrupted file, reset
    }
  }
  return { previews: [], results: [], igPreviews: [], igResults: [] };
}

function saveTracking(data: TrackingData): void {
  writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
}

async function getEventSlug(race: typeof races.$inferSelect): Promise<string | null> {
  if (!race.raceEventId) return null;
  try {
    const [event] = await db.select({ slug: raceEvents.slug }).from(raceEvents).where(eqOp(raceEvents.id, race.raceEventId)).limit(1);
    return event?.slug ?? null;
  } catch { return null; }
}

// Only post Instagram stories for elite road/mtb WorldCup races (skip junior/u23 series)
function shouldPostToInstagram(race: { name: string; discipline?: string | null; categorySlug?: string | null; uciCategory?: string | null }): boolean {
  const name = (race.name || "").toLowerCase();
  const category = (race.categorySlug || "").toLowerCase();
  const uci = (race.uciCategory || "").toLowerCase();
  // Skip junior, u23, junior-series
  if (category.includes("junior") || category.includes("u23")) return false;
  if (name.includes("junior") || name.includes("u23")) return false;
  // Only WorldTour, 1.Pro, 1.UWT, or top MTB (UCI XCO World Cup / C1)
  if (uci.includes("worldtour") || uci.includes("1.pro") || uci.includes("1.uwt") || uci.includes("world cup") || uci.includes("c1")) return true;
  // Also allow if no category but it's a recognisable major race
  if (name.includes("omloop") || name.includes("strade bianche") || name.includes("milan") || name.includes("ronde") || name.includes("paris-roubaix") || name.includes("liege") || name.includes("amstel") || name.includes("fleche")) return true;
  return false;
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

  const upcomingRaces = await db
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

    // Instagram Stories — elite races only
    const igPreviewSlug = await getEventSlug(race);
    if (igPreviewSlug && shouldPostToInstagram(race) && !tracking.igPreviews.includes(race.id)) {
      console.log(`📸 Posting Instagram Story preview: ${race.name}`);
      try {
        execSync(
          `node_modules/.bin/tsx scripts/agents/post-to-instagram.ts --event ${igPreviewSlug} --type preview --stories`,
          { encoding: "utf-8", stdio: "inherit", cwd: process.cwd(), timeout: 120000 }
        );
        tracking.igPreviews.push(race.id);
        saveTracking(tracking);
        console.log(`✅ Instagram Story preview posted: ${race.name}\n`);
      } catch (err) {
        console.error(`❌ Instagram Story preview failed for ${race.name}:`, (err as any)?.message?.slice(0, 200));
      }
    }
  }

  // ─── 2. RESULTS: Races completed yesterday ────────────────────
  const yesterday = dayStr(-1);

  console.log(`\n🔍 Looking for completed races from ${yesterday}...\n`);

  // Find races from yesterday that have results
  const completedRaces = await db
    .select()
    .from(races)
    .where(
      and(
        eq(races.date, yesterday),
        sql`${races.id} IN (SELECT ${raceResults.raceId} FROM ${raceResults} GROUP BY ${raceResults.raceId})`
      )
    )
    .orderBy(races.date);

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

    // Instagram Stories — elite races only
    const igResultSlug = await getEventSlug(race);
    if (igResultSlug && shouldPostToInstagram(race) && !tracking.igResults.includes(race.id)) {
      console.log(`📸 Posting Instagram Story result: ${race.name}`);
      try {
        execSync(
          `node_modules/.bin/tsx scripts/agents/post-to-instagram.ts --event ${igResultSlug} --type results --stories`,
          { encoding: "utf-8", stdio: "inherit", cwd: process.cwd(), timeout: 120000 }
        );
        tracking.igResults.push(race.id);
        saveTracking(tracking);
        console.log(`✅ Instagram Story result posted: ${race.name}\n`);
      } catch (err) {
        console.error(`❌ Instagram Story result failed for ${race.name}:`, (err as any)?.message?.slice(0, 200));
      }
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
