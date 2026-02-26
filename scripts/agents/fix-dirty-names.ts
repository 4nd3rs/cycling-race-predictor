/**
 * fix-dirty-names.ts
 *
 * Finds race / race_event rows whose names contain HTML, excess whitespace,
 * newlines, or other junk from bad XCOdata/scraper runs, then cleans them.
 *
 * Cleaning strategy:
 *  1. Strip HTML tags
 *  2. Collapse whitespace / newlines to single spaces
 *  3. Trim leading/trailing spaces
 *  4. If the result is still looks like garbage (< 3 chars or > 200 chars),
 *     log it for manual review and skip.
 *
 * Usage:
 *   tsx scripts/agents/fix-dirty-names.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../../src/lib/db/schema";
import { eq } from "drizzle-orm";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
const dryRun = process.argv.includes("--dry-run");

// ─── Cleaners ────────────────────────────────────────────────────────────────

const MONTHS = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Collapse whitespace + strip HTML entities only */
function collapseWhitespace(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Extract the pure event name from a junk-padded XCOdata name.
 * XCOdata was inserting the full table cell text:
 *   "AMS UCC India #1  26 - 28 Feb 2026  Bir Billing, Himachal Pradesh  Winner - Elite Women"
 *
 * Strategy:
 *  1. Collapse whitespace / strip HTML
 *  2. Remove " Winner..." suffix and everything after it
 *  3. Remove trailing date + location block:
 *       "26 - 28 Feb 2026  Location" or "24 Jan 2026  Location"
 *  4. Trim
 */
function extractEventName(raw: string): string {
  let s = collapseWhitespace(raw);

  // Strip " Winner" and everything after (case-insensitive)
  s = s.replace(/\s+Winner.*$/i, "");

  // Strip trailing date range + optional location:
  //   " 26 - 28 Feb 2026 Some City, Country"  or  " 24 Jan 2026 CityName"
  const datePattern = new RegExp(
    `\\s+\\d{1,2}(?:\\s*-\\s*\\d{1,2})?\\s+${MONTHS}\\s+\\d{4}.*$`,
    "i"
  );
  s = s.replace(datePattern, "");

  return s.trim();
}

/**
 * Clean a races.name value.
 * Format is "{event name} - Elite Men" / "{event name} - Elite Women" etc.
 * We split on the category suffix, clean the base, and re-join.
 */
function cleanRaceName(raw: string): string {
  const s = collapseWhitespace(raw);

  // Split on category suffix like " - Elite Men", " - Elite Women", " - U23 Men", etc.
  const catMatch = s.match(/^([\s\S]+?)(\s+-\s+(?:Elite|U23|Junior|Masters)\s+(?:Men|Women))$/i);
  if (catMatch) {
    const base = extractEventName(catMatch[1]);
    const suffix = catMatch[2].trim(); // e.g. "- Elite Women"
    return base ? `${base} - ${suffix.replace(/^-\s*/, "")}` : s;
  }

  // No category suffix found — just clean the whole thing
  return extractEventName(s) || s;
}

/**
 * Clean a race_events.name value (no category suffix, just the event name).
 */
function cleanEventName(raw: string): string {
  const cleaned = extractEventName(raw);
  return cleaned || collapseWhitespace(raw);
}

function isDirty(name: string): boolean {
  // Dirty if: contains newline/tabs, has HTML, or has a date pattern embedded in the middle
  const hasNewline = /[\n\r\t]/.test(name);
  const hasHtml = /<[^>]+>/.test(name);
  const hasEmbeddedDate = new RegExp(`\\d{1,2}\\s+${MONTHS}\\s+\\d{4}`, "i").test(name);
  return hasNewline || hasHtml || hasEmbeddedDate || name.length > 200;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🧹 Dirty Name Fixer${dryRun ? " [DRY RUN]" : ""}`);
  console.log("─────────────────────────────\n");

  // ── Races ──
  // Fetch all and filter client-side (isDirty checks for newlines and embedded dates,
  // not just length, so we can't rely solely on char_length)
  const races = await db
    .select({ id: schema.races.id, name: schema.races.name })
    .from(schema.races);

  const dirtyRaces = races.filter(r => isDirty(r.name));
  console.log(`Found ${dirtyRaces.length} dirty race names (of ${races.length} total)\n`);

  let raceFixed = 0, raceSkipped = 0;
  for (const r of dirtyRaces) {
    const cleaned = cleanRaceName(r.name);
    if (cleaned.length < 3) {
      console.log(`⚠️  SKIP (too short after clean): ${JSON.stringify(r.name.substring(0, 80))}`);
      raceSkipped++;
      continue;
    }
    if (cleaned === r.name) continue; // already clean
    console.log(`  BEFORE: ${JSON.stringify(r.name.substring(0, 100).replace(/\n/g, "↵"))}`);
    console.log(`  AFTER : ${JSON.stringify(cleaned)}\n`);
    if (!dryRun) {
      await db.update(schema.races).set({ name: cleaned }).where(eq(schema.races.id, r.id));
    }
    raceFixed++;
  }

  // ── Race Events ──
  const events = await db
    .select({ id: schema.raceEvents.id, name: schema.raceEvents.name })
    .from(schema.raceEvents);

  const dirtyEvents = events.filter(e => isDirty(e.name));
  console.log(`Found ${dirtyEvents.length} dirty race_event names (of ${events.length} total)\n`);

  let eventFixed = 0, eventSkipped = 0;
  for (const e of dirtyEvents) {
    const cleaned = cleanEventName(e.name);
    if (cleaned.length < 3) {
      console.log(`⚠️  SKIP (too short after clean): ${JSON.stringify(e.name.substring(0, 80))}`);
      eventSkipped++;
      continue;
    }
    if (cleaned === e.name) continue; // already clean
    console.log(`  BEFORE: ${JSON.stringify(e.name.substring(0, 100).replace(/\n/g, "↵"))}`);
    console.log(`  AFTER : ${JSON.stringify(cleaned)}\n`);
    if (!dryRun) {
      await db.update(schema.raceEvents).set({ name: cleaned }).where(eq(schema.raceEvents.id, e.id));
    }
    eventFixed++;
  }

  // ── Summary ──
  console.log("─────────────────────────────");
  console.log(`Races:       ${raceFixed} fixed, ${raceSkipped} skipped`);
  console.log(`Race events: ${eventFixed} fixed, ${eventSkipped} skipped`);
  if (dryRun) console.log("\n(dry-run — nothing written to DB)");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
