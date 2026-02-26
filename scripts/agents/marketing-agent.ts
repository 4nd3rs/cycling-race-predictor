import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { db, races, raceResults } from "./lib/db";
import { and, gte, lte, eq, sql } from "drizzle-orm";

const TRACKING_FILE = "/tmp/marketing-posted.json";

interface TrackingData {
  previews: string[]; // race IDs
  results: string[];  // race IDs
}

function loadTracking(): TrackingData {
  if (existsSync(TRACKING_FILE)) {
    try {
      return JSON.parse(readFileSync(TRACKING_FILE, "utf-8"));
    } catch {
      // Corrupted file, reset
    }
  }
  return { previews: [], results: [] };
}

function saveTracking(data: TrackingData): void {
  writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
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
