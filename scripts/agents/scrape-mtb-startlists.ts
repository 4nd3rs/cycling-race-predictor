/**
 * MTB Startlist & Results Scraper
 * Supports: sportstiming.dk | my.raceresult.com | live.eqtiming.com
 *
 * Flow:
 *   1. Find upcoming/recent MTB race_events with a known timing_system
 *   2. Fetch startlists (pre-race) and/or results (post-race) per category
 *   3. Upsert riders + race_startlist rows; for results, also insert race_results rows
 *
 * Usage:
 *   tsx scripts/agents/scrape-mtb-startlists.ts [--event-id <uuid>] [--days <n>] [--ahead <n>] [--dry-run] [--results-only] [--startlist-only]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import {
  scrapeResults,
  scrapeStartlist,
  classifyCategory,
  type TimingSystem,
  SUPPORTED_TIMING_SYSTEMS,
} from "../../src/lib/scraper/timing-adapters";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const eventIdArg    = getArg("event-id");
const daysBack      = parseInt(getArg("days", "3"), 10);
const daysAhead     = parseInt(getArg("ahead", "14"), 10);
const dryRun        = args.includes("--dry-run");
const resultsOnly   = args.includes("--results-only");
const startlistOnly = args.includes("--startlist-only");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Rider upsert ─────────────────────────────────────────────────────────────

function normalizeName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  if (/^[A-Z][A-Z\-]+$/.test(parts[0])) {
    const lastName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
    const firstName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    return { firstName, lastName };
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

async function upsertRider(rawName: string, nationality?: string): Promise<string | null> {
  const { firstName, lastName } = normalizeName(rawName);
  if (!lastName) return null;

  const existing = await db.query.riders.findFirst({
    where: and(eq(schema.riders.firstName, firstName), eq(schema.riders.lastName, lastName)),
  });
  if (existing) return existing.id;

  const [created] = await db.insert(schema.riders).values({
    firstName, lastName, nationality: nationality ?? null, discipline: "mtb",
  }).returning({ id: schema.riders.id });
  return created.id;
}

// ─── Race lookup ──────────────────────────────────────────────────────────────
async function findRace(raceEventId: string, ageCategory: string, gender: string) {
  return db.query.races.findFirst({
    where: and(
      eq(schema.races.raceEventId, raceEventId),
      eq(schema.races.ageCategory, ageCategory),
      eq(schema.races.gender, gender),
      eq(schema.races.discipline, "mtb"),
    ),
  });
}

// ─── Process event ────────────────────────────────────────────────────────────

async function processEvent(event: typeof schema.raceEvents.$inferSelect) {
  const timingSystem = event.timingSystem as TimingSystem;
  const timingEventId = event.timingEventId!;
  console.log(`  → ${timingSystem} event ${timingEventId}`);

  // Startlists
  if (!resultsOnly) {
    try {
      const entries = await scrapeStartlist(timingSystem, timingEventId);
      console.log(`  📋 ${entries.length} startlist entries total`);

      if (!dryRun) {
        for (const entry of entries) {
          const match = classifyCategory(entry.categoryName);
          if (!match) continue;
          const race = await findRace(event.id, match.ageCategory, match.gender);
          if (!race) continue;
          const riderId = await upsertRider(entry.riderName, entry.nationality);
          if (riderId) {
            await db.insert(schema.raceStartlist).values({
              raceId: race.id, riderId, bibNumber: entry.bibNumber ?? null,
            }).onConflictDoNothing();
          }
        }
      }
    } catch (e: any) {
      console.log(`  ❌ Startlist error: ${e.message}`);
    }
    await sleep(800);
  }

  // Results (post-race)
  if (!startlistOnly && new Date(event.date) <= new Date()) {
    try {
      const results = await scrapeResults(timingSystem, timingEventId);
      console.log(`  🏁 ${results.length} results total`);

      if (!dryRun && results.length > 0) {
        // Group by category
        const byCat = new Map<string, typeof results>();
        for (const r of results) {
          const match = classifyCategory(r.categoryName);
          if (!match) continue;
          const key = `${match.ageCategory}:${match.gender}`;
          if (!byCat.has(key)) byCat.set(key, []);
          byCat.get(key)!.push(r);
        }

        for (const [catKey, catResults] of byCat) {
          const [ageCategory, gender] = catKey.split(":");
          const race = await findRace(event.id, ageCategory, gender);
          if (!race) { console.log(`    ⚠️  No race for ${catKey}`); continue; }

          // Insert into raceStartlist
          for (const r of catResults) {
            const riderId = await upsertRider(r.riderName, r.nationality);
            if (riderId) {
              await db.insert(schema.raceStartlist).values({
                raceId: race.id, riderId, bibNumber: null,
              }).onConflictDoNothing();
            }
          }

          // Insert into raceResults
          const existing = new Set(
            (await db.select({ riderId: schema.raceResults.riderId })
              .from(schema.raceResults).where(eq(schema.raceResults.raceId, race.id)))
              .map(r => r.riderId)
          );
          let inserted = 0;
          for (const r of catResults) {
            const riderId = await upsertRider(r.riderName, r.nationality);
            if (!riderId || existing.has(riderId)) continue;
            await db.insert(schema.raceResults).values({
              raceId: race.id, riderId,
              position: r.position,
              timeSeconds: r.timeSeconds,
              dnf: r.dnf, dns: r.dns,
            });
            existing.add(riderId);
            inserted++;
          }

          if (inserted > 0) {
            await db.update(schema.races).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.races.id, race.id));
            console.log(`    ✅ ${catKey}: ${inserted} results stored, race marked completed`);
          } else {
            console.log(`    📋 ${catKey}: results already imported`);
          }
        }
      }
    } catch (e: any) {
      console.log(`  ❌ Results error: ${e.message}`);
    }
  }

  await sleep(1000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().substring(0, 10);
  const pastDate = new Date(Date.now() - daysBack * 86400000).toISOString().substring(0, 10);
  const futureDate = new Date(Date.now() + daysAhead * 86400000).toISOString().substring(0, 10);

  let events;
  if (eventIdArg) {
    const e = await db.query.raceEvents.findFirst({ where: eq(schema.raceEvents.id, eventIdArg) });
    events = e ? [e] : [];
  } else {
    events = await db.query.raceEvents.findMany({
      where: and(
        eq(schema.raceEvents.discipline, "mtb"),
        gte(schema.raceEvents.date, pastDate),
        lte(schema.raceEvents.date, futureDate),
      ),
      orderBy: [schema.raceEvents.date],
    });
    // Only events with a supported timing system
    events = events.filter(e =>
      e.timingSystem &&
      e.timingEventId &&
      SUPPORTED_TIMING_SYSTEMS.includes(e.timingSystem as TimingSystem)
    );
  }

  if (events.length === 0) { console.log("No events with timing links found."); return; }
  console.log(`Processing ${events.length} event(s)...\n`);

  for (const event of events) {
    console.log(`\n📍 ${event.name} [${event.date}] — ${event.timingSystem}`);
    try {
      await processEvent(event);
    } catch (e: any) {
      console.log(`  💥 Error: ${e.message}`);
    }
    await sleep(1500);
  }

  console.log("\n✅ Done.");
}

main().catch(console.error);
