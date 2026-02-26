/**
 * predictions-agent.ts
 *
 * OpenClaw cron agent: auto-generates predictions for upcoming races.
 *
 * Logic:
 *  1. Find active races starting within the next N days
 *  2. Skip races that already have up-to-date predictions (within 24h)
 *  3. Run generate-predictions.ts for each eligible race
 *  4. Report results
 *
 * Run: node_modules/.bin/tsx scripts/agents/predictions-agent.ts [--days 3] [--force] [--race-id <uuid>]
 *
 * OpenClaw cron: every 6 hours (or schedule before big race days)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, sql, isNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { execSync } from "child_process";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ── Config ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DAYS_AHEAD = parseInt(args.find(a => a.startsWith("--days"))?.split("=")[1] || "3", 10);
const FORCE = args.includes("--force");
const SINGLE_RACE_ID = args[args.indexOf("--race-id") + 1] || null;

// Minimum hype for auto-predictions (skip very low-profile C2 races)
function getHypeScore(uciCategory: string | null | undefined): number {
  const cat = (uciCategory || "").toUpperCase().trim();
  if (cat === "WORLDTOUR" || cat === "1.UWT") return 100;
  if (cat === "WC") return 90;
  if (cat === "1.PRO" || cat === "2.PRO") return 80;
  if (cat === "C1") return 70;
  if (cat === "1.1" || cat === "2.1") return 50;
  return 30;
}

const MIN_HYPE = 50; // Skip C2 and unknown category races
const MIN_STARTLIST = 5; // Skip if less than 5 riders

async function run() {
  const today = new Date().toISOString().split("T")[0];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + DAYS_AHEAD);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  console.log(`\n🔮 Predictions Agent — looking for races in next ${DAYS_AHEAD} days (${today} → ${cutoffStr})\n`);

  let racesToProcess: typeof schema.races.$inferSelect[] = [];

  if (SINGLE_RACE_ID) {
    // Single race mode
    const race = await db.query.races.findFirst({ where: eq(schema.races.id, SINGLE_RACE_ID) });
    if (race) racesToProcess = [race];
    else { console.error(`Race ${SINGLE_RACE_ID} not found`); process.exit(1); }
  } else {
    // Find upcoming active races with startlists
    racesToProcess = await db
      .select({ ...schema.races })
      .from(schema.races)
      .innerJoin(schema.raceEvents, eq(schema.races.raceEventId, schema.raceEvents.id))
      .where(
        and(
          eq(schema.races.status, "active"),
          gte(schema.raceEvents.date, today),
          lte(schema.raceEvents.date, cutoffStr)
        )
      )
      .orderBy(schema.raceEvents.date);
  }

  console.log(`📋 Found ${racesToProcess.length} active races in window`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const race of racesToProcess) {
    // Check hype
    const hype = getHypeScore(race.uciCategory);
    if (!SINGLE_RACE_ID && hype < MIN_HYPE) {
      console.log(`  ⏭  ${race.name} — hype ${hype} < ${MIN_HYPE}, skipping`);
      skipped++;
      continue;
    }

    // Check startlist size
    const [countRow] = await db
      .select({ c: sql<number>`count(*)` })
      .from(schema.raceStartlist)
      .where(eq(schema.raceStartlist.raceId, race.id));
    const startlistSize = Number(countRow?.c) || 0;

    if (startlistSize < MIN_STARTLIST) {
      console.log(`  ⏭  ${race.name} — only ${startlistSize} riders in startlist, skipping`);
      skipped++;
      continue;
    }

    // Check if predictions already exist and are recent (within 24h) — unless forced
    if (!FORCE) {
      const [existingPred] = await db
        .select({ createdAt: schema.predictions.createdAt })
        .from(schema.predictions)
        .where(eq(schema.predictions.raceId, race.id))
        .orderBy(sql`${schema.predictions.createdAt} DESC`)
        .limit(1);

      if (existingPred) {
        const ageHours = (Date.now() - existingPred.createdAt.getTime()) / 3600000;
        if (ageHours < 24) {
          console.log(`  ✅ ${race.name} — predictions fresh (${ageHours.toFixed(1)}h ago), skipping`);
          skipped++;
          continue;
        }
      }
    }

    // Generate predictions
    console.log(`\n🏁 Generating predictions for: ${race.name} (${race.date}) [hype=${hype}, riders=${startlistSize}]`);
    try {
      const output = execSync(
        `node_modules/.bin/tsx scripts/agents/generate-predictions.ts --race-id ${race.id}`,
        { encoding: "utf8", timeout: 120000 }
      );
      // Print last few lines
      const lines = output.trim().split("\n");
      lines.slice(-5).forEach(l => console.log(`   ${l}`));
      generated++;
    } catch (e: unknown) {
      console.error(`  ❌ Error generating predictions for ${race.name}:`, (e as Error).message?.split("\n")[0]);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Generated: ${generated}`);
  console.log(`  ⏭  Skipped:   ${skipped}`);
  console.log(`  ❌ Errors:    ${errors}`);

  if (generated > 0) {
    console.log(`\n✨ ${generated} race(s) now have fresh predictions!`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
