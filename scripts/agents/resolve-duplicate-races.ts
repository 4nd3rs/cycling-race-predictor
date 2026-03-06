/**
 * Finds and removes duplicate race rows within the same race_event.
 * A duplicate = same race_event_id + same gender + same age_category.
 * Keeps the row with the most data (startlist > results > pcsUrl > oldest id).
 * Deletes the rest.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents } from "./lib/db";
import { eq, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n🔁 Duplicate Race Resolver ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log("──────────────────────────────────────────────\n");

  // Find all groups that have more than one race with same event+gender+ageCategory
  const rows = await db.select({
    raceId: races.id,
    eventId: races.raceEventId,
    eventName: raceEvents.name,
    gender: races.gender,
    ageCategory: races.ageCategory,
    date: races.date,
    pcsUrl: races.pcsUrl,
    status: races.status,
    startlist: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
    results: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
  })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .orderBy(races.raceEventId, races.gender, races.ageCategory);

  // Group by event+gender+ageCategory
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.eventId}|${row.gender}|${row.ageCategory}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Only consider true duplicates: same year in pcsUrl or both null
  // Skip groups where rows have different year pcsUrls (different seasons accidentally sharing an event)
  const duplicateGroups = [...groups.values()].filter(g => {
    if (g.length < 2) return false;
    const years = g.map(r => r.pcsUrl?.match(/\/(\d{4})/)?.[1] ?? r.date?.toString().slice(0, 4) ?? "");
    const uniqueYears = new Set(years.filter(Boolean));
    if (uniqueYears.size > 1) {
      console.log(`  ⚠️  Skipping cross-year group: ${g[0].eventName} (${g[0].gender}) — years: ${[...uniqueYears].join(", ")}`);
      return false;
    }
    return true;
  });
  console.log(`Total race rows: ${rows.length}`);
  console.log(`Duplicate groups found: ${duplicateGroups.length}\n`);

  if (duplicateGroups.length === 0) {
    console.log("No duplicates. ✅");
    return;
  }

  let totalDeleted = 0;

  for (const group of duplicateGroups) {
    // Score each row — higher = better to keep
    const scored = group.map(r => ({
      ...r,
      score:
        Number(r.results) * 1000 +
        Number(r.startlist) * 100 +
        (r.pcsUrl ? 10 : 0) +
        (r.status === "completed" ? 5 : 0),
    })).sort((a, b) => b.score - a.score);

    const keep = scored[0];
    const toDelete = scored.slice(1);

    console.log(`📌 ${keep.eventName} (${keep.gender}/${keep.ageCategory}) — ${keep.date}`);
    console.log(`   KEEP: ${keep.raceId} (startlist=${keep.startlist}, results=${keep.results}, url=${keep.pcsUrl ?? "null"})`);

    for (const r of toDelete) {
      console.log(`   DEL:  ${r.raceId} (startlist=${r.startlist}, results=${r.results}, url=${r.pcsUrl ?? "null"})`);
      if (!DRY_RUN) {
        await db.delete(races).where(eq(races.id, r.raceId));
        totalDeleted++;
      }
    }
  }

  if (!DRY_RUN) {
    console.log(`\n✅ Deleted ${totalDeleted} duplicate race rows.`);
  } else {
    console.log(`\n(Dry run — re-run without --dry-run to delete)`);
  }
}

main().catch(console.error);
