/**
 * AI-Powered Timing Link Discovery Agent
 *
 * For MTB race_events that have no timing_system set, uses Brave Search + Claude
 * to intelligently discover timing platforms.
 *
 * Searches: sportstiming.dk, my.raceresult.com, live.eqtiming.com
 * Uses Claude to interpret ambiguous search results (partial name matches,
 * alternate languages, multi-event weekends).
 *
 * Usage:
 *   tsx scripts/agents/discover-timing-ai.ts [--event-id <uuid>] [--days <n>] [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, or, isNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const eventIdArg = getArg("event-id");
const daysAhead  = parseInt(getArg("days", "60"), 10);
const daysBack   = parseInt(getArg("past", "7"), 10);
const dryRun     = args.includes("--dry-run");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Brave Search ─────────────────────────────────────────────────────────────
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

interface SearchResult { url: string; title: string; description: string }

async function braveSearch(query: string): Promise<SearchResult[]> {
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

// ─── Timing system extractors ─────────────────────────────────────────────────

interface TimingResult {
  system: string;
  eventId: string;
  url: string;
  confidence: "high" | "medium" | "low";
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

/** Strip UCI series tags for cleaner search queries */
function cleanRaceName(name: string): string {
  return name
    .replace(/\s*\+\s*UCI\s+[A-Z]+\s+[A-Z]+\s+Series/gi, "")
    .replace(/\s*-\s*Round\s+\d+/gi, "")
    .replace(/\s*#\d+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Regex-based discovery (fast path) ────────────────────────────────────────

async function regexDiscover(eventName: string, year: number): Promise<TimingResult | null> {
  const clean = cleanRaceName(eventName);
  const short = clean.split(/\s+/).slice(0, 4).join(" ");

  const queries = [
    { q: `"${clean}" ${year} site:sportstiming.dk`,     system: "sportstiming", extractor: extractSportstimingId },
    { q: `"${clean}" ${year} site:live.eqtiming.com`,   system: "eqtiming",     extractor: extractEqTimingId },
    { q: `"${clean}" ${year} site:my.raceresult.com`,   system: "raceresult",   extractor: extractRaceResultId },
    { q: `"${short}" ${year} site:sportstiming.dk`,     system: "sportstiming", extractor: extractSportstimingId },
    { q: `"${short}" ${year} site:live.eqtiming.com`,   system: "eqtiming",     extractor: extractEqTimingId },
    { q: `"${short}" ${year} site:my.raceresult.com`,   system: "raceresult",   extractor: extractRaceResultId },
  ];

  for (const { q, system, extractor } of queries) {
    await sleep(600);
    const results = await braveSearch(q);
    for (const r of results) {
      const id = extractor(r.url);
      if (id) {
        return { system, eventId: id, url: r.url.split("?")[0], confidence: "high" };
      }
      // Also scan description for embedded links
      const allText = r.url + " " + r.description;
      const stId = extractSportstimingId(allText);
      if (stId) return { system: "sportstiming", eventId: stId, url: `https://www.sportstiming.dk/event/${stId}`, confidence: "medium" };
      const eqId = extractEqTimingId(allText);
      if (eqId) return { system: "eqtiming", eventId: eqId, url: `https://live.eqtiming.com/${eqId}`, confidence: "medium" };
      const rrId = extractRaceResultId(allText);
      if (rrId) return { system: "raceresult", eventId: rrId, url: `https://my.raceresult.com/${rrId}`, confidence: "medium" };
    }
  }

  return null;
}

// ─── AI-powered discovery (fallback) ──────────────────────────────────────────

async function aiDiscover(eventName: string, eventDate: string, year: number): Promise<TimingResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("   ℹ️  No ANTHROPIC_API_KEY — skipping AI discovery");
    return null;
  }

  const clean = cleanRaceName(eventName);

  // General search for the race
  await sleep(600);
  const generalResults = await braveSearch(`"${clean}" ${year} MTB XCO startlist results timing`);

  if (generalResults.length === 0) return null;

  // Check if any general results contain timing URLs
  for (const r of generalResults) {
    const allText = r.url + " " + r.description + " " + r.title;
    const stId = extractSportstimingId(allText);
    if (stId) return { system: "sportstiming", eventId: stId, url: `https://www.sportstiming.dk/event/${stId}`, confidence: "medium" };
    const eqId = extractEqTimingId(allText);
    if (eqId) return { system: "eqtiming", eventId: eqId, url: `https://live.eqtiming.com/${eqId}`, confidence: "medium" };
    const rrId = extractRaceResultId(allText);
    if (rrId) return { system: "raceresult", eventId: rrId, url: `https://my.raceresult.com/${rrId}`, confidence: "medium" };
  }

  // Use Claude to interpret ambiguous results
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();

    const searchContext = generalResults
      .map((r, i) => `${i + 1}. URL: ${r.url}\n   Title: ${r.title}\n   Description: ${r.description}`)
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `I'm looking for the live timing/results page for this MTB XCO race:
- Name: ${clean}
- Date: ${eventDate}
- Year: ${year}

The timing platforms I support are:
- sportstiming.dk (URL pattern: sportstiming.dk/event/{id})
- my.raceresult.com (URL pattern: my.raceresult.com/{id})
- live.eqtiming.com (URL pattern: live.eqtiming.com/{id})

Here are search results I found:
${searchContext}

Based on these search results, can you identify which timing platform hosts this race's results? If you find a match, respond with ONLY a JSON object like:
{"system": "sportstiming", "eventId": "12345", "url": "https://www.sportstiming.dk/event/12345"}

If you can't confidently identify the timing platform, respond with: {"system": null}

Consider: the race name might be in a different language, the event might be part of a multi-race weekend, or the URL might contain a different but related event name.`,
      }],
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const jsonMatch = textBlock.text.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.system && parsed.eventId && parsed.url) {
      return { system: parsed.system, eventId: parsed.eventId, url: parsed.url, confidence: "low" };
    }
  } catch (e: any) {
    console.warn(`   ⚠️  AI discovery error: ${e.message}`);
  }

  return null;
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
        isNull(schema.raceEvents.timingSystem),
        or(
          and(gte(schema.raceEvents.date, today), lte(schema.raceEvents.date, futureDate)),
          and(gte(schema.raceEvents.date, pastDate), lte(schema.raceEvents.date, today)),
        ),
      ),
      orderBy: [schema.raceEvents.date],
    });
  }

  if (events.length === 0) {
    console.log("No MTB events without timing links in range.");
    return;
  }

  console.log(`🔍 Discovering timing links for ${events.length} event(s)...\n`);

  let found = 0;
  let notFound = 0;

  for (const event of events) {
    const year = new Date(event.date).getFullYear();
    console.log(`📍 ${event.name} [${event.date}]`);

    // Try regex-based discovery first (fast, high confidence)
    let result = await regexDiscover(event.name, year);

    // If not found, try AI-powered discovery
    if (!result) {
      console.log(`   🤖 Trying AI discovery...`);
      result = await aiDiscover(event.name, event.date, year);
    }

    if (result) {
      console.log(`   ✅ Found: ${result.system} / ID: ${result.eventId} (${result.confidence} confidence)`);
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
      found++;
    } else {
      console.log(`   ❌ Not found — manual lookup needed`);
      notFound++;
    }

    await sleep(1000);
  }

  console.log(`\n✅ Discovery complete: ${found} found, ${notFound} not found.`);
}

main().catch(console.error);
