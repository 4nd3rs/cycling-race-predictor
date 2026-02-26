import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceEvents, raceResults, riders, riderDisciplineStats, raceStartlist } from "./lib/db";
import { eq, and, gte, lte, ilike, desc, sql, isNull, count } from "drizzle-orm";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) i++;
    }
  }
  return args;
}

async function upcomingRaces() {
  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: races.id,
      name: races.name,
      date: races.date,
      endDate: races.endDate,
      discipline: races.discipline,
      raceType: races.raceType,
      ageCategory: races.ageCategory,
      gender: races.gender,
      uciCategory: races.uciCategory,
      country: races.country,
      status: races.status,
      eventId: raceEvents.id,
      eventName: raceEvents.name,
    })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(gte(races.date, nowStr), lte(races.date, futureStr)))
    .orderBy(races.date);

  return rows;
}

async function recentRacesNoResults() {
  const now = new Date();
  const past = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 10);
  const pastStr = past.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: races.id,
      name: races.name,
      date: races.date,
      endDate: races.endDate,
      discipline: races.discipline,
      raceType: races.raceType,
      ageCategory: races.ageCategory,
      gender: races.gender,
      uciCategory: races.uciCategory,
      country: races.country,
      status: races.status,
      pcsUrl: races.pcsUrl,
    })
    .from(races)
    .where(
      and(
        gte(races.date, pastStr),
        lte(races.date, nowStr),
        sql`${races.id} NOT IN (SELECT ${raceResults.raceId} FROM ${raceResults} GROUP BY ${raceResults.raceId})`,
        sql`${races.status} != 'completed'`
      )
    )
    .orderBy(races.date);

  return rows;
}

async function startlistStatus() {
  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);

  const upcoming = await db
    .select({
      id: races.id,
      name: races.name,
      date: races.date,
      discipline: races.discipline,
      gender: races.gender,
      uciCategory: races.uciCategory,
      pcsUrl: races.pcsUrl,
      status: races.status,
    })
    .from(races)
    .where(and(gte(races.date, nowStr), lte(races.date, futureStr)))
    .orderBy(races.date);

  // Count startlist entries per race
  const counts = await db
    .select({ raceId: raceStartlist.raceId, count: count() })
    .from(raceStartlist)
    .groupBy(raceStartlist.raceId);

  const countMap = new Map(counts.map(c => [c.raceId, Number(c.count)]));

  return upcoming.map(r => ({
    ...r,
    startlistCount: countMap.get(r.id) ?? 0,
    hasPcsUrl: !!r.pcsUrl,
  }));
}

async function topRiders(limit: number) {
  const rows = await db
    .select({
      riderId: riders.id,
      name: riders.name,
      nationality: riders.nationality,
      discipline: riderDisciplineStats.discipline,
      ageCategory: riderDisciplineStats.ageCategory,
      currentElo: riderDisciplineStats.currentElo,
      racesTotal: riderDisciplineStats.racesTotal,
      winsTotal: riderDisciplineStats.winsTotal,
      podiumsTotal: riderDisciplineStats.podiumsTotal,
    })
    .from(riderDisciplineStats)
    .innerJoin(riders, eq(riderDisciplineStats.riderId, riders.id))
    .orderBy(desc(riderDisciplineStats.currentElo))
    .limit(limit);

  return rows;
}

async function raceExists(name: string, date: string) {
  const [row] = await db
    .select({ id: races.id, name: races.name, date: races.date })
    .from(races)
    .where(and(ilike(races.name, `%${name}%`), eq(races.date, date)))
    .limit(1);

  return { exists: !!row, race: row || null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;

  if (!mode) {
    console.error("Usage: npx tsx scripts/agents/db-query.ts --mode <mode> [options]");
    console.error("Modes: upcoming-races, recent-races-no-results, startlist-status, top-riders, race-exists");
    process.exit(1);
  }

  let result: unknown;

  switch (mode) {
    case "upcoming-races":
      result = await upcomingRaces();
      break;
    case "recent-races-no-results":
      result = await recentRacesNoResults();
      break;
    case "top-riders": {
      const limit = parseInt(args.limit || "50", 10);
      result = await topRiders(limit);
      break;
    }
    case "startlist-status":
      result = await startlistStatus();
      break;
    case "race-exists": {
      if (!args.name || !args.date) {
        console.error("--name and --date required for race-exists mode");
        process.exit(1);
      }
      result = await raceExists(args.name, args.date);
      break;
    }
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
