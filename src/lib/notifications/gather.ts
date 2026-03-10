import {
  db,
  races,
  raceEvents,
  raceStartlist,
  raceResults,
  riders,
  predictions,
  teams,
  raceNews,
  riderRumours,
  startlistEvents,
} from "@/lib/db";
import { eq, and, gte, asc, desc, inArray } from "drizzle-orm";
import type { DailyContext, GatheredRace, GatheredPrediction, GatheredResult, GatheredNewsArticle, GatheredRumour, StartlistEvent as StartlistEventType } from "./types";

export async function gatherContext(): Promise<DailyContext> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // ── Parallel queries ──────────────────────────────────────────────────────

  const [todayRows, tomorrowRows, completedRows, newsRows, rumourRows] = await Promise.all([
    // Today's active races
    db.select({
      raceId: races.id,
      raceName: races.name,
      date: races.date,
      discipline: races.discipline,
      uciCategory: races.uciCategory,
      raceEventId: races.raceEventId,
      categorySlug: races.categorySlug,
      startTime: races.startTime,
      status: races.status,
      stageNumber: races.stageNumber,
      parentRaceId: races.parentRaceId,
      eventName: raceEvents.name,
      country: raceEvents.country,
      eventSlug: raceEvents.slug,
      eventDiscipline: raceEvents.discipline,
    })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(eq(races.date, today), eq(races.status, "active")))
      .orderBy(asc(races.startTime)),

    // Tomorrow's active races
    db.select({
      raceId: races.id,
      raceName: races.name,
      date: races.date,
      discipline: races.discipline,
      uciCategory: races.uciCategory,
      raceEventId: races.raceEventId,
      categorySlug: races.categorySlug,
      startTime: races.startTime,
      status: races.status,
      stageNumber: races.stageNumber,
      parentRaceId: races.parentRaceId,
      eventName: raceEvents.name,
      country: raceEvents.country,
      eventSlug: raceEvents.slug,
      eventDiscipline: raceEvents.discipline,
    })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(eq(races.date, tomorrow), eq(races.status, "active")))
      .orderBy(asc(races.startTime)),

    // Recent completed races (last 48h)
    db.select({
      raceId: races.id,
      raceName: races.name,
      date: races.date,
      discipline: races.discipline,
      uciCategory: races.uciCategory,
      raceEventId: races.raceEventId,
      categorySlug: races.categorySlug,
      startTime: races.startTime,
      status: races.status,
      stageNumber: races.stageNumber,
      parentRaceId: races.parentRaceId,
      eventName: raceEvents.name,
      country: raceEvents.country,
      eventSlug: raceEvents.slug,
      eventDiscipline: raceEvents.discipline,
    })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(eq(races.status, "completed"), gte(races.date, twoDaysAgo)))
      .orderBy(desc(races.date)),

    // Recent news articles (last 24h)
    db.select({
      id: raceNews.id,
      raceEventId: raceNews.raceEventId,
      title: raceNews.title,
      summary: raceNews.summary,
      url: raceNews.url,
      source: raceNews.source,
      publishedAt: raceNews.publishedAt,
    })
      .from(raceNews)
      .where(gte(raceNews.publishedAt, oneDayAgo))
      .orderBy(desc(raceNews.publishedAt))
      .limit(50),

    // Recent rumours (last 24h)
    db.select({
      riderId: riderRumours.riderId,
      riderName: riders.name,
      raceId: riderRumours.raceId,
      summary: riderRumours.summary,
      sentiment: riderRumours.aggregateScore,
      lastUpdated: riderRumours.lastUpdated,
    })
      .from(riderRumours)
      .innerJoin(riders, eq(riderRumours.riderId, riders.id))
      .where(gte(riderRumours.lastUpdated, oneDayAgo))
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(50),
  ]);

  // Map rows to GatheredRace format
  function toGatheredRace(r: typeof todayRows[number]): GatheredRace {
    return {
      raceId: r.raceId,
      raceName: r.raceName,
      eventName: r.eventName,
      eventSlug: r.eventSlug,
      categorySlug: r.categorySlug,
      discipline: r.eventDiscipline || r.discipline || "road",
      uciCategory: r.uciCategory,
      country: r.country,
      date: r.date,
      raceEventId: r.raceEventId!,
      startTime: r.startTime,
      status: r.status || "active",
      stageNumber: r.stageNumber,
      parentRaceId: r.parentRaceId,
    };
  }

  const todayRaces = todayRows.filter(r => r.raceEventId).map(toGatheredRace);
  const tomorrowRaces = tomorrowRows.filter(r => r.raceEventId).map(toGatheredRace);
  const recentResults = completedRows.filter(r => r.raceEventId).map(toGatheredRace);

  // ── Startlists for today + tomorrow races ─────────────────────────────────
  // For stages, use the parent race's startlist

  const allRaces = [...todayRaces, ...tomorrowRaces, ...recentResults];
  const allRaceIds = allRaces.map(r => r.raceId);
  // Also include parent race IDs for stages that need to inherit startlists
  const parentRaceIds = allRaces
    .filter(r => r.parentRaceId)
    .map(r => r.parentRaceId!);
  const queryRaceIds = [...new Set([...allRaceIds, ...parentRaceIds])];

  const startlistsByRace = new Map<string, Set<string>>();
  const startlistTeamsByRace = new Map<string, Map<string, string>>();
  const riderNameMap = new Map<string, string>();
  const teamNameMap = new Map<string, string>();

  if (queryRaceIds.length > 0) {
    const slRows = await db
      .select({
        raceId: raceStartlist.raceId,
        riderId: raceStartlist.riderId,
        teamId: raceStartlist.teamId,
        riderName: riders.name,
        teamName: teams.name,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
      .where(inArray(raceStartlist.raceId, queryRaceIds));

    for (const sl of slRows) {
      if (!startlistsByRace.has(sl.raceId)) startlistsByRace.set(sl.raceId, new Set());
      startlistsByRace.get(sl.raceId)!.add(sl.riderId);

      if (sl.teamId) {
        if (!startlistTeamsByRace.has(sl.raceId)) startlistTeamsByRace.set(sl.raceId, new Map());
        startlistTeamsByRace.get(sl.raceId)!.set(sl.riderId, sl.teamId);
        if (sl.teamName) teamNameMap.set(sl.teamId, sl.teamName);
      }

      riderNameMap.set(sl.riderId, sl.riderName);
    }

    // For stages without their own startlist, inherit from parent
    for (const race of allRaces) {
      if (race.parentRaceId && !startlistsByRace.has(race.raceId)) {
        const parentSl = startlistsByRace.get(race.parentRaceId);
        if (parentSl) {
          startlistsByRace.set(race.raceId, parentSl);
        }
        const parentTeams = startlistTeamsByRace.get(race.parentRaceId);
        if (parentTeams) {
          startlistTeamsByRace.set(race.raceId, parentTeams);
        }
      }
    }
  }

  // ── Predictions for all races ─────────────────────────────────────────────
  // Include parent race IDs so stages can inherit predictions

  const predictionsByRace = new Map<string, GatheredPrediction[]>();

  if (queryRaceIds.length > 0) {
    const predRows = await db
      .select({
        raceId: predictions.raceId,
        riderId: predictions.riderId,
        riderName: riders.name,
        teamName: teams.name,
        predictedPosition: predictions.predictedPosition,
        winProbability: predictions.winProbability,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .leftJoin(teams, eq(riders.teamId, teams.id))
      .where(inArray(predictions.raceId, queryRaceIds))
      .orderBy(asc(predictions.predictedPosition));

    for (const p of predRows) {
      if (!predictionsByRace.has(p.raceId)) predictionsByRace.set(p.raceId, []);
      predictionsByRace.get(p.raceId)!.push({
        raceId: p.raceId,
        riderId: p.riderId,
        riderName: p.riderName,
        teamName: p.teamName,
        predictedPosition: p.predictedPosition,
        winProbability: parseFloat(String(p.winProbability || "0")),
      });
    }
  }

  // For stages without their own predictions, inherit from parent
  for (const race of allRaces) {
    if (race.parentRaceId && !predictionsByRace.has(race.raceId)) {
      const parentPreds = predictionsByRace.get(race.parentRaceId);
      if (parentPreds) {
        predictionsByRace.set(race.raceId, parentPreds);
      }
    }
  }

  // ── Results for completed races ───────────────────────────────────────────

  const resultsByRace = new Map<string, GatheredResult[]>();
  const completedIds = recentResults.map(r => r.raceId);

  if (completedIds.length > 0) {
    const resRows = await db
      .select({
        raceId: raceResults.raceId,
        riderId: raceResults.riderId,
        riderName: riders.name,
        teamName: teams.name,
        position: raceResults.position,
        dnf: raceResults.dnf,
        dns: raceResults.dns,
      })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .leftJoin(teams, eq(raceResults.teamId, teams.id))
      .where(inArray(raceResults.raceId, completedIds))
      .orderBy(asc(raceResults.position));

    for (const r of resRows) {
      if (!resultsByRace.has(r.raceId)) resultsByRace.set(r.raceId, []);
      resultsByRace.get(r.raceId)!.push({
        raceId: r.raceId,
        riderId: r.riderId,
        riderName: r.riderName,
        teamName: r.teamName,
        position: r.position,
        dnf: r.dnf ?? false,
        dns: r.dns ?? false,
      });
    }
  }

  // ── Startlist events ───────────────────────────────────────────────────────

  let startlistEventsList: StartlistEventType[] = [];
  try {
    const seRows = await db
      .select({
        raceId: startlistEvents.raceId,
        riderId: startlistEvents.riderId,
        eventType: startlistEvents.eventType,
        detectedAt: startlistEvents.detectedAt,
        riderName: riders.name,
        raceName: races.name,
        eventName: raceEvents.name,
        eventSlug: raceEvents.slug,
        discipline: raceEvents.discipline,
      })
      .from(startlistEvents)
      .innerJoin(riders, eq(startlistEvents.riderId, riders.id))
      .innerJoin(races, eq(startlistEvents.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(gte(startlistEvents.detectedAt, oneDayAgo))
      .orderBy(desc(startlistEvents.detectedAt));

    startlistEventsList = seRows.map(se => ({
      raceId: se.raceId,
      riderId: se.riderId,
      riderName: se.riderName,
      raceName: se.raceName,
      eventName: se.eventName,
      eventSlug: se.eventSlug,
      discipline: se.discipline,
      eventType: se.eventType as "added" | "removed",
      detectedAt: se.detectedAt,
    }));
  } catch {
    // Table may not exist yet during migration
  }

  // ── News articles ─────────────────────────────────────────────────────────

  const newsArticles: GatheredNewsArticle[] = newsRows.map(n => ({
    id: n.id,
    raceEventId: n.raceEventId,
    title: n.title,
    summary: n.summary,
    url: n.url,
    source: n.source,
    publishedAt: n.publishedAt,
  }));

  // ── Rumours ───────────────────────────────────────────────────────────────

  const rumours: GatheredRumour[] = rumourRows.map(r => ({
    riderId: r.riderId,
    riderName: r.riderName,
    raceId: r.raceId,
    summary: r.summary,
    sentiment: parseFloat(String(r.sentiment || "0")),
    lastUpdated: r.lastUpdated,
  }));

  return {
    todayRaces,
    tomorrowRaces,
    recentResults,
    startlistsByRace,
    startlistTeamsByRace,
    predictionsByRace,
    resultsByRace,
    newsArticles,
    rumours,
    startlistEvents: startlistEventsList,
    riderNames: riderNameMap,
    teamNames: teamNameMap,
  };
}
