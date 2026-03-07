/**
 * Timing Link Discovery Agent
 *
 * For UCI MTB race_events that have no timing_system set, tries to discover
 * the correct timing system and event ID automatically via:
 *   1. Brave Search API: "{race name} {year} site:sportstiming.dk"
 *   2. Brave Search API: "{race name} {year} site:live.eqtiming.com"
 *   3. General search to find the race website, then probe for timing links
 *
 * Stores discovered timing_system + timing_event_id + timing_event_url in race_events.
 *
 * Usage:
 *   tsx scripts/agents/discover-timing-links.ts [--event-id <uuid>] [--days <n>] [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const eventIdArg  = getArg("event-id");
const daysAhead   = parseInt(getArg("days", "60"), 10);
const dryRun      = args.includes("--dry-run");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Brave Search ─────────────────────────────────────────────────────────────
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

async function braveSearch(query: string): Promise<Array<{ url: string; title: string; description: string }>> {
  if (!BRAVE_API_KEY) {
    console.warn("  ⚠️  No BRAVE_SEARCH_API_KEY — skipping web search");
    return [];
  }
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.warn(`  ⚠️  Brave search failed: ${res.status}`);
    return [];
  }
  const data = await res.json() as any;
  return (data.web?.results ?? []).map((r: any) => ({
    url: r.url,
    title: r.title ?? "",
    description: r.description ?? "",
  }));
}

// ─── Timing system detectors ──────────────────────────────────────────────────

interface TimingResult {
  system: string;
  eventId: string;
  url: string;
}

function extractSportstimingId(url: string): string | null {
  const m = url.match(/sportstiming\.dk\/event\/(\d+)/i);
  return m ? m[1] : null;
}

function extractEqTimingId(url: string): string | null {
  const m = url.match(/live\.eqtiming\.com\/(\d+)/i);
  return m ? m[1] : null;
}

function extractRaceResultId(url: string): string | null {
  const m = url.match(/my\.raceresult\.com\/(\d+)/i);
  return m ? m[1] : null;
}

/** Strip UCI series tags and normalize name for search */
function cleanRaceName(name: string): string {
  return name
    .replace(/\s*\+\s*UCI\s+[A-Z]+\s+[A-Z]+\s+Series/gi, "")  // "+ UCI XCO Junior Series"
    .replace(/\s*-\s*Round\s+\d+/gi, "")
    .replace(/\s*#\d+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function discoverTiming(eventName: string, year: number): Promise<TimingResult | null> {
  const clean = cleanRaceName(eventName);
  // Also try abbreviated name (first 3 words) for long race names
  const short = clean.split(/\s+/).slice(0, 4).join(" ");

  const queries = [
    { q: `"${clean}" ${year} site:sportstiming.dk`,     system: "sportstiming", extractor: extractSportstimingId },
    { q: `"${clean}" ${year} site:live.eqtiming.com`,   system: "eqtiming",     extractor: extractEqTimingId },
    { q: `"${clean}" ${year} site:my.raceresult.com`,   system: "raceresult",   extractor: extractRaceResultId },
    { q: `"${short}" ${year} site:sportstiming.dk`,     system: "sportstiming", extractor: extractSportstimingId },
    { q: `"${short}" ${year} site:live.eqtiming.com`,   system: "eqtiming",     extractor: extractEqTimingId },
    { q: `"${short}" ${year} MTB XCO results timing`,   system: "unknown",      extractor: (_: string) => null },
  ];

  for (const { q, system, extractor } of queries) {
    await sleep(600); // rate limit
    const results = await braveSearch(q);
    for (const r of results) {
      const id = extractor(r.url);
      if (id) {
        return { system, eventId: id, url: r.url.split("?")[0] };
      }
      // Also scan the description for embedded links
      const allText = r.url + " " + r.description;
      const stId = extractSportstimingId(allText);
      if (stId) return { system: "sportstiming", eventId: stId, url: `https://www.sportstiming.dk/event/${stId}` };
      const eqId = extractEqTimingId(allText);
      if (eqId) return { system: "eqtiming", eventId: eqId, url: `https://live.eqtiming.com/${eqId}` };
      const rrId = extractRaceResultId(allText);
      if (rrId) return { system: "raceresult", eventId: rrId, url: `https://my.raceresult.com/${rrId}` };
    }
  }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().substring(0, 10);
  const futureDate = new Date(Date.now() + daysAhead * 86400000).toISOString().substring(0, 10);

  let events;
  if (eventIdArg) {
    const e = await db.query.raceEvents.findFirst({ where: eq(schema.raceEvents.id, eventIdArg) });
    events = e ? [e] : [];
  } else {
    // MTB race events in the next N days with no timing system set
    events = await db.query.raceEvents.findMany({
      where: and(
        eq(schema.raceEvents.discipline, "mtb"),
        isNull(schema.raceEvents.timingSystem),
        gte(schema.raceEvents.date, today),
        lte(schema.raceEvents.date, futureDate),
      ),
      orderBy: [schema.raceEvents.date],
    });
  }

  if (events.length === 0) {
    console.log("No MTB events without timing links in range.");
    return;
  }

  console.log(`🔍 Searching timing links for ${events.length} event(s)...\n`);

  for (const event of events) {
    const year = new Date(event.date).getFullYear();
    console.log(`📍 ${event.name} [${event.date}]`);

    const result = await discoverTiming(event.name, year);
    if (result) {
      console.log(`   ✅ Found: ${result.system} / ID: ${result.eventId}`);
      console.log(`      URL: ${result.url}`);

      if (!dryRun) {
        await db.update(schema.raceEvents)
          .set({
            timingSystem: result.system,
            timingEventId: result.eventId,
            timingEventUrl: result.url,
          })
          .where(eq(schema.raceEvents.id, event.id));
        console.log(`   💾 Saved to DB`);
      }
    } else {
      console.log(`   ❌ Not found — manual lookup needed`);
    }

    await sleep(1000);
  }

  console.log("\n✅ Discovery complete.");
}

main().catch(console.error);
