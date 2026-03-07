import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { PredictionList } from "@/components/prediction-card";
import { WhatsAppJoinButton } from "@/components/whatsapp-join-button";
import { FollowButton } from "@/components/follow-button";
import { RaceLinksSection } from "@/components/race-links";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, races, predictions, riders, raceStartlist, riderDisciplineStats, raceResults, riderRumours, teams, raceEvents, raceNews } from "@/lib/db";
import { eq, desc, and, or, gte, ne, inArray, isNull, sql } from "drizzle-orm";
import { format, formatDistanceToNow } from "date-fns";
import { generateRacePredictions, calculateForm, type RiderPredictionInput, type RecentResult, RACE_CATEGORY_WEIGHTS, type ProfileType } from "@/lib/prediction";
import { formatCategoryDisplay } from "@/lib/category-utils";
import { isNotNull } from "drizzle-orm";
import {
  isValidDiscipline,
  getDisciplineLabel,
  getSubDisciplineShortLabel,
  parseCategorySlug,
  buildCategoryUrl,
  generateCategorySlug,
  normalizeUciCategory } from "@/lib/url-utils";


// ── Weather ────────────────────────────────────────────────────────────────

const COUNTRY_COORDS: Record<string, { lat: number; lon: number; city: string }> = {
  BEL: { lat: 50.85, lon: 4.35, city: "Belgium" },
  ITA: { lat: 41.90, lon: 12.49, city: "Italy" },
  FRA: { lat: 48.85, lon: 2.35, city: "France" },
  ESP: { lat: 40.41, lon: -3.70, city: "Spain" },
  NED: { lat: 52.37, lon: 4.89, city: "Netherlands" },
  SUI: { lat: 46.95, lon: 7.44, city: "Switzerland" },
  GBR: { lat: 51.50, lon: -0.12, city: "UK" },
  GER: { lat: 52.52, lon: 13.40, city: "Germany" },
  NOR: { lat: 59.91, lon: 10.75, city: "Norway" },
  DEN: { lat: 55.67, lon: 12.57, city: "Denmark" },
  AUT: { lat: 48.20, lon: 16.37, city: "Austria" },
  POL: { lat: 52.22, lon: 21.01, city: "Poland" },
  SLO: { lat: 46.05, lon: 14.50, city: "Slovenia" },
  POR: { lat: 38.71, lon: -9.14, city: "Portugal" },
};

type RaceWeather = {
  tempMax: number; tempMin: number;
  precipMm: number; windKmh: number;
  weatherCode: number; city: string;
} | null;

async function getRaceWeather(country: string | null, date: string): Promise<RaceWeather> {
  if (!country || !COUNTRY_COORDS[country]) return null;
  const { lat, lon, city } = COUNTRY_COORDS[country];
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode&timezone=auto&start_date=${date}&end_date=${date}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.daily;
    if (!d?.temperature_2m_max?.[0]) return null;
    return {
      tempMax: Math.round(d.temperature_2m_max[0]),
      tempMin: Math.round(d.temperature_2m_min[0]),
      precipMm: Math.round(d.precipitation_sum[0] * 10) / 10,
      windKmh: Math.round(d.windspeed_10m_max[0]),
      weatherCode: d.weathercode[0],
      city,
    };
  } catch { return null; }
}

function wmoToEmoji(code: number): { emoji: string; desc: string } {
  if (code === 0) return { emoji: "☀️", desc: "Clear sky" };
  if (code <= 2) return { emoji: "⛅", desc: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", desc: "Overcast" };
  if (code <= 49) return { emoji: "🌫️", desc: "Fog" };
  if (code <= 67) return { emoji: "🌧️", desc: "Rain" };
  if (code <= 77) return { emoji: "❄️", desc: "Snow" };
  if (code <= 82) return { emoji: "🌦️", desc: "Showers" };
  if (code <= 99) return { emoji: "⛈️", desc: "Thunderstorm" };
  return { emoji: "🌡️", desc: "Unknown" };
}

// ──────────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ discipline: string; eventSlug: string; categorySlug: string }>;
}

async function getEventBySlug(discipline: string, slug: string) {
  try {
    const [event] = await db
      .select()
      .from(raceEvents)
      .where(
        and(
          eq(raceEvents.discipline, discipline),
          eq(raceEvents.slug, slug)
        )
      )
      .limit(1);

    return event;
  } catch {
    return null;
  }
}

async function getRaceByCategorySlug(eventId: string, categorySlug: string) {
  // Parse category slug
  const parsed = parseCategorySlug(categorySlug);
  if (!parsed) return null;

  try {
    // Try to find by category_slug first, preferring active races
    let [race] = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.raceEventId, eventId),
          eq(races.categorySlug, categorySlug)
        )
      )
      .orderBy(desc(races.date))
      .limit(1);

    // Fallback: find by ageCategory + gender
    if (!race) {
      [race] = await db
        .select()
        .from(races)
        .where(
          and(
            eq(races.raceEventId, eventId),
            eq(races.ageCategory, parsed.ageCategory),
            eq(races.gender, parsed.gender)
          )
        )
        .orderBy(desc(races.date))
        .limit(1);
    }

    // Inherit uciCategory from sibling elite race if null
    if (race && !race.uciCategory) {
      const [sibling] = await db
        .select({ uciCategory: races.uciCategory })
        .from(races)
        .where(
          and(
            eq(races.raceEventId, eventId),
            eq(races.ageCategory, "elite")
          )
        )
        .limit(1);
      if (sibling?.uciCategory) {
        race = { ...race, uciCategory: sibling.uciCategory };
      }
    }

    return race;
  } catch {
    return null;
  }
}

async function getRacePredictions(raceId: string, race: typeof races.$inferSelect) {
  try {
    const isMtbRace = race.discipline === "mtb";

    // For U23 races, also match elite stats since UCI ranks U23 within elite
    const ageCategory = race.ageCategory || "elite";
    const ageCategories = ageCategory === "u23" ? ["u23", "elite"] : [ageCategory];

    // Get predictions with rider and stats
    // Prefer AI predictions — if any exist, only return those
    const aiCheck = await db
      .select({ id: predictions.id })
      .from(predictions)
      .where(and(eq(predictions.raceId, raceId), sql`source = 'ai'`))
      .limit(1);
    const hasAi = aiCheck.length > 0;

    const results = await db
      .select({
        prediction: predictions,
        rider: riders,
        stats: riderDisciplineStats,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      // Only include riders actually in the current startlist
      .innerJoin(raceStartlist, and(
        eq(raceStartlist.raceId, raceId),
        eq(raceStartlist.riderId, riders.id)
      ))
      .leftJoin(
        riderDisciplineStats,
        isMtbRace
          ? and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, "mtb"),
              inArray(riderDisciplineStats.ageCategory, ageCategories)
            )
          : and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, race.discipline)
            )
      )
      .where(
        hasAi
          ? and(eq(predictions.raceId, raceId), sql`${predictions}.source = 'ai'`)
          : eq(predictions.raceId, raceId)
      );

    // Get team info from startlist separately
    const startlistTeams = await db
      .select({
        riderId: raceStartlist.riderId,
        teamName: teams.name,
      })
      .from(raceStartlist)
      .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
      .where(eq(raceStartlist.raceId, raceId));

    const teamByRiderId = new Map(
      startlistTeams.map((s) => [s.riderId, s.teamName])
    );

    // Deduplicate by rider ID and add team info
    const uniqueByRider = new Map<string, (typeof results)[0] & { teamName: string | null }>();
    for (const row of results) {
      const existing = uniqueByRider.get(row.rider.id);
      if (!existing || (row.stats?.uciPoints && !existing.stats?.uciPoints)) {
        uniqueByRider.set(row.rider.id, {
          ...row,
          teamName: teamByRiderId.get(row.rider.id) || null,
        });
      }
    }

    return Array.from(uniqueByRider.values());
  } catch (error) {
    console.error("Error getting race predictions:", error);
    return [];
  }
}

async function getRaceStartlist(raceId: string, race?: typeof races.$inferSelect) {
  try {
    const isMtb = race?.discipline === "mtb";
    // For U23 races, also match elite stats since UCI ranks U23 within elite
    const ageCategory = race?.ageCategory || "elite";
    const ageCategories = ageCategory === "u23" ? ["u23", "elite"] : [ageCategory];

    const results = await db
      .select({
        entry: raceStartlist,
        rider: riders,
        team: teams,
        stats: riderDisciplineStats,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
      .leftJoin(
        riderDisciplineStats,
        isMtb
          ? and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, "mtb"),
              inArray(riderDisciplineStats.ageCategory, ageCategories)
            )
          : and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, race?.discipline || "road")
            )
      )
      .where(eq(raceStartlist.raceId, raceId))
      .orderBy(raceStartlist.bibNumber)
      .limit(150);

    // Deduplicate: for U23 with elite fallback, prefer the row with UCI points
    const uniqueByEntry = new Map<string, (typeof results)[number]>();
    for (const row of results) {
      const key = row.entry.id;
      const existing = uniqueByEntry.get(key);
      if (!existing || (row.stats?.uciPoints && !existing.stats?.uciPoints)) {
        uniqueByEntry.set(key, row);
      }
    }

    return Array.from(uniqueByEntry.values());
  } catch {
    return [];
  }
}

async function getRaceResults(raceId: string, discipline: string) {
  try {
    const results = await db
      .select({
        result: raceResults,
        rider: riders,
        team: teams,
      })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .leftJoin(teams, eq(raceResults.teamId, teams.id))
      .where(eq(raceResults.raceId, raceId));

    // Sort: finishers by position, then DNF, then DNS
    return results.sort((a, b) => {
      const posA = a.result.position || 9999;
      const posB = b.result.position || 9999;
      if (a.result.dns && !b.result.dns) return 1;
      if (!a.result.dns && b.result.dns) return -1;
      if (a.result.dnf && !b.result.dnf) return 1;
      if (!a.result.dnf && b.result.dnf) return -1;
      return posA - posB;
    });
  } catch {
    return [];
  }
}

async function getSiblingRaces(eventId: string, currentRaceId: string, discipline: string, eventSlug: string) {
  try {
    const siblings = await db
      .select({
        id: races.id,
        name: races.name,
        ageCategory: races.ageCategory,
        gender: races.gender,
        categorySlug: races.categorySlug,
      })
      .from(races)
      .where(
        and(
          eq(races.raceEventId, eventId),
          ne(races.id, currentRaceId)
        )
      )
      .orderBy(races.ageCategory, races.gender);

    // Add URL to each sibling
    return siblings.map((s) => ({
      ...s,
      href: s.categorySlug
        ? buildCategoryUrl(discipline, eventSlug, s.categorySlug)
        : `/races/${s.id}`,
    }));
  } catch {
    return [];
  }
}

// Generate predictions if they don't exist
async function generatePredictionsIfNeeded(race: typeof races.$inferSelect, startlistCount: number) {
  const existingCount = await db
    .select({ id: predictions.id })
    .from(predictions)
    .where(eq(predictions.raceId, race.id))
    .limit(1);

  if (existingCount.length > 0 || startlistCount === 0) {
    return;
  }

  try {
    const startlistEntries = await db
      .select({
        entry: raceStartlist,
        rider: riders,
        stats: riderDisciplineStats,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .leftJoin(
        riderDisciplineStats,
        race.discipline === "mtb"
          ? and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, "mtb"),
              eq(riderDisciplineStats.ageCategory, race.ageCategory || "elite")
            )
          : and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, race.discipline)
            )
      )
      .where(eq(raceStartlist.raceId, race.id));

    const uniqueRiders = new Map<string, { rider: typeof riders.$inferSelect; stats: typeof riderDisciplineStats.$inferSelect | null }>();
    for (const { rider, stats } of startlistEntries) {
      if (!uniqueRiders.has(rider.id)) {
        uniqueRiders.set(rider.id, { rider, stats });
      }
    }

    const riderIds = Array.from(uniqueRiders.keys());
    if (riderIds.length === 0) return;

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const allRecentResults = await db
      .select({
        result: raceResults,
        race: races,
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .where(gte(races.date, ninetyDaysAgo.toISOString().split("T")[0]));

    const resultsByRider = new Map<string, typeof allRecentResults>();
    for (const row of allRecentResults) {
      const riderId = row.result.riderId;
      if (riderIds.includes(riderId)) {
        const existing = resultsByRider.get(riderId) || [];
        existing.push(row);
        resultsByRider.set(riderId, existing);
      }
    }

    const allRumours = await db.select().from(riderRumours);
    const rumoursByRider = new Map<string, typeof riderRumours.$inferSelect>();
    for (const rumour of allRumours) {
      if (riderIds.includes(rumour.riderId)) {
        rumoursByRider.set(rumour.riderId, rumour);
      }
    }

    const predictionInputs: RiderPredictionInput[] = [];

    for (const [riderId, { rider, stats }] of uniqueRiders) {
      const recentResults = (resultsByRider.get(riderId) || []).slice(0, 20);

      const formResults: RecentResult[] = recentResults.map(({ result, race: r }) => ({
        date: new Date(r.date),
        position: result.position,
        fieldSize: 150,
        raceWeight: RACE_CATEGORY_WEIGHTS[r.uciCategory || ""] || 0.5,
        profileType: r.profileType || "hilly",
        dnf: result.dnf || false,
      }));

      const formScore = calculateForm(formResults);
      const rumour = rumoursByRider.get(riderId);
      const affinities = (stats?.profileAffinities || {}) as Record<string, number>;
      const raceProfile = race.profileType || "hilly";
      const profileAffinity = affinities[raceProfile] || 0.5;

      predictionInputs.push({
        riderId,
        riderName: rider.name,
        eloMean: parseFloat(stats?.eloMean || "1500"),
        eloVariance: parseFloat(stats?.eloVariance || "350") ** 2,
        formScore,
        profileAffinity,
        profileSampleSize: stats?.racesTotal || 0,
        rumourScore: parseFloat(rumour?.aggregateScore || "0"),
        rumourTipCount: rumour?.tipCount || 0,
      });
    }

    const result = generateRacePredictions(
      race.id,
      predictionInputs,
      (race.profileType || "hilly") as ProfileType
    );

    if (result.predictions.length > 0) {
      await db.insert(predictions).values(
        result.predictions.map((pred) => ({
          raceId: race.id,
          riderId: pred.riderId,
          predictedPosition: pred.predictedPosition,
          winProbability: pred.winProbability.toString(),
          podiumProbability: pred.podiumProbability.toString(),
          top10Probability: pred.top10Probability.toString(),
          confidenceScore: pred.confidence.toString(),
          reasoning: pred.reasoning,
          eloScore: pred.eloScore.toString(),
          formScore: pred.formMultiplier.toString(),
          profileAffinityScore: pred.profileMultiplier.toString(),
          rumourModifier: pred.rumourModifier.toString(),
          version: result.version,
        }))
      );
    }
  } catch (error) {
    console.error("Error generating predictions:", error);
  }
}

async function getRaceIntel(raceId: string) {
  try {
    const result = await db
      .select({ rumour: riderRumours, rider: riders })
      .from(riderRumours)
      .innerJoin(riders, eq(riderRumours.riderId, riders.id))
      .innerJoin(raceStartlist, eq(raceStartlist.riderId, riders.id))
      .where(and(eq(raceStartlist.raceId, raceId), isNotNull(riderRumours.summary)))
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(10);

    // Deduplicate by rider ID (a rider may appear multiple times from join)
    const seen = new Set<string>();
    return result.filter(({ rider }) => {
      if (seen.has(rider.id)) return false;
      seen.add(rider.id);
      return true;
    });
  } catch {
    return [];
  }
}

async function getRaceNews(eventId: string, raceId?: string) {
  try {
    // If raceId is provided, filter to articles for this specific race OR neutral articles (race_id IS NULL)
    const whereClause = raceId
      ? and(eq(raceNews.raceEventId, eventId), or(eq(raceNews.raceId, raceId), isNull(raceNews.raceId)))
      : eq(raceNews.raceEventId, eventId);
    return await db
      .select()
      .from(raceNews)
      .where(whereClause)
      .orderBy(desc(raceNews.publishedAt))
      .limit(6);
  } catch {
    return [];
  }
}

function countryToFlag(countryCode?: string | null) {
  if (!countryCode) return null;
  const code = countryCode.toUpperCase();
  if (code.length === 2) {
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  const alpha3ToAlpha2: Record<string, string> = {
    GER: "DE", USA: "US", RSA: "ZA", GBR: "GB", NED: "NL", DEN: "DK",
    SUI: "CH", AUT: "AT", BEL: "BE", FRA: "FR", ITA: "IT", ESP: "ES",
    POR: "PT", NOR: "NO", SWE: "SE", FIN: "FI", POL: "PL", CZE: "CZ",
    AUS: "AU", NZL: "NZ", JPN: "JP", COL: "CO", ECU: "EC", SLO: "SI",
    CRO: "HR", UKR: "UA", KAZ: "KZ", ERI: "ER", ETH: "ET", RWA: "RW",
  };
  const alpha2 = alpha3ToAlpha2[code] || code.slice(0, 2);
  return String.fromCodePoint(...[...alpha2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function calculateAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  return new Date().getFullYear() - new Date(birthDate).getFullYear();
}

function getProfileIcon(profile?: string | null) {
  const icons: Record<string, string> = {
    flat: "\u2796",
    hilly: "\u3030\ufe0f",
    mountain: "\u26f0\ufe0f",
    tt: "\u23f1\ufe0f",
    cobbles: "\ud83e\udea8",
  };
  return profile ? icons[profile] || "\ud83d\udeb4" : "\ud83d\udeb4";
}

export default async function CategoryPage({ params }: PageProps) {
  const { discipline, eventSlug, categorySlug } = await params;

  // Validate discipline
  if (!isValidDiscipline(discipline)) {
    notFound();
  }

  // Get event
  const event = await getEventBySlug(discipline, eventSlug);
  if (!event) {
    notFound();
  }

  // Get race by category slug
  const race = await getRaceByCategorySlug(event.id, categorySlug);
  if (!race) {
    notFound();
  }

  // Get race results
  const results = await getRaceResults(race.id, race.discipline);
  const hasResults = results.length > 0;
  const isCompleted = race.status === "completed" || hasResults;

  // Date helpers — race.date is stored as UTC midnight of local race day
  // (e.g. 2026-03-06T23:00Z = March 7 Italy/Stockholm)
  const raceDate = new Date(race.date);
  const raceEndApprox = new Date(raceDate.getTime() + 18 * 60 * 60 * 1000);
  const isUpcoming = raceEndApprox > new Date() && !isCompleted;
  const isLive = !isCompleted && raceDate <= new Date() && raceEndApprox > new Date();

  // Get startlist (with stats for point-based sorting)
  const startlist = await getRaceStartlist(race.id, race);

  // Get sibling races
  const siblingRaces = await getSiblingRaces(event.id, race.id, discipline, eventSlug);

  // Generate ELO predictions only if no AI predictions exist
  if (startlist.length > 0 && !isCompleted) {
    const aiExists = await db
      .select({ id: predictions.id })
      .from(predictions)
      .where(and(eq(predictions.raceId, race.id), sql`source = 'ai'`))
      .limit(1);
    if (aiExists.length === 0) {
      await generatePredictionsIfNeeded(race, startlist.length);
    }
  }

  // Get race intel (rumours for riders on the startlist) + weather in parallel
  const [raceIntel, weather, latestNews] = await Promise.all([
    getRaceIntel(race.id),
    (() => {
      // Fetch weather for upcoming + live races
      // race.date is stored as UTC midnight of the local race day (e.g. 2026-03-06T23:00Z = March 7 Italy)
      // Add 1h to get correct YYYY-MM-DD in the race's local timezone
      const localDateStr = new Date(raceDate.getTime() + 60 * 60 * 1000).toISOString().split("T")[0];
      return isUpcoming ? getRaceWeather(event.country, localDateStr) : Promise.resolve(null);
    })(),
    getRaceNews(event.id, race.id),
  ]);

  // Get predictions
  const racePredictions = isCompleted ? [] : await getRacePredictions(race.id, race);

  // Format predictions
  const formattedPredictions = racePredictions
    .map(({ prediction, rider, stats, teamName }) => {
      const confidence = parseFloat(prediction.confidenceScore || "0");
      const uciPts = stats?.uciPoints ? parseInt(String(stats.uciPoints)) : 0;
      const hasRaceResults = (stats?.racesTotal ?? 0) > 0;
      const hasEnoughData = confidence >= 0.4 || uciPts > 0 || hasRaceResults;

      return {
        riderId: rider.id,
        riderName: rider.name,
        nationality: rider.nationality || undefined,
        birthDate: rider.birthDate || undefined,
        photoUrl: rider.photoUrl || undefined,
        teamName: teamName || undefined,
        predictedPosition: prediction.predictedPosition || 0,
        winProbability: hasEnoughData ? parseFloat(prediction.winProbability || "0") : 0,
        podiumProbability: hasEnoughData ? parseFloat(prediction.podiumProbability || "0") : 0,
        top10Probability: hasEnoughData ? parseFloat(prediction.top10Probability || "0") : 0,
        reasoning: prediction.reasoning || undefined,
        source: (prediction as any).source || 'elo',
        uciPoints: stats?.uciPoints ? parseInt(String(stats.uciPoints)) : 0,
        uciRank: stats?.uciRank || null,
        supercupPoints: stats?.supercupPoints ? parseInt(String(stats.supercupPoints)) : 0,
        // Show ELO if the record exists (even if seeded from UCI pts, racesTotal=0)
        eloScore: stats?.currentElo && parseFloat(stats.currentElo) !== 0
          ? Math.round(parseFloat(stats.currentElo))
          : undefined,
        eloIsSeeded: stats?.currentElo && (stats.racesTotal ?? 0) === 0, // UCI-seeded, no real race history
        confidence,
        hasEnoughData,
      };
    })
    .sort((a, b) => {
      // Riders with ranking data first, sorted by predicted performance
      if (a.hasEnoughData !== b.hasEnoughData) return a.hasEnoughData ? -1 : 1;

      if (a.hasEnoughData && b.hasEnoughData) {
        // Sort by prediction engine's position (based on ELO + form + profile)
        return a.predictedPosition - b.predictedPosition;
      }

      // Among riders without data: UCI points > National team > alphabetical
      const aHasPoints = a.uciPoints > 0;
      const bHasPoints = b.uciPoints > 0;
      if (aHasPoints !== bHasPoints) return aHasPoints ? -1 : 1;
      if (aHasPoints && bHasPoints) return b.uciPoints - a.uciPoints;

      return a.riderName.localeCompare(b.riderName);
    })
;

  const isSuperCup = event.series === "supercup";
  const disciplineLabel = getDisciplineLabel(discipline);
  const categoryDisplay = formatCategoryDisplay(race.ageCategory || "elite", race.gender || "men");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">

        {/* ── Race Hero ──────────────────────────────────────────────── */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground flex-wrap">
              <Link href="/races" className="hover:text-foreground transition-colors">Races</Link>
              <span>/</span>
              <Link href={`/races/${discipline}`} className="hover:text-foreground transition-colors capitalize">{discipline}</Link>
              <span>/</span>
              <Link href={`/races/${discipline}/${eventSlug}`} className="hover:text-foreground transition-colors">{event.name}</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{categoryDisplay}</span>
            </nav>

            <div className="flex flex-col lg:flex-row gap-8">

              {/* ── Left: race identity ─────────────── */}
              <div className="flex-1 space-y-4">

                {/* Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{disciplineLabel}</Badge>
                  {event.subDiscipline && (
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      {getSubDisciplineShortLabel(event.subDiscipline)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                    {categoryDisplay}
                  </Badge>
                  {race.uciCategory && (
                    <Badge variant="outline" className="border-primary/50 text-primary font-mono font-semibold">{normalizeUciCategory(race.uciCategory)}</Badge>
                  )}
                  {isCompleted
                    ? <Badge variant="secondary">Completed</Badge>
                    : isLive
                    ? <Badge className="bg-red-500 text-white">🔴 Live</Badge>
                    : <Badge className="bg-green-500 text-white">Upcoming</Badge>}
                </div>

                {/* Title */}
                <div>
                  <h1 className="text-3xl font-black tracking-tight">{event.name}</h1>
                  <p className="text-lg text-muted-foreground mt-0.5">{categoryDisplay}</p>
                </div>

                {/* Date + location */}
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span>
                    {event.country && countryToFlag(event.country)}{" "}
                    {format(raceDate, "EEEE, MMMM d, yyyy")}
                  </span>
                  {race.country && race.country !== event.country && (
                    <span className="flex items-center gap-1">{countryToFlag(race.country)} {race.country}</span>
                  )}
                </div>

                {/* Key facts strip */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {race.distanceKm && (
                    <span className="flex items-center gap-1">
                      📏 {parseFloat(String(race.distanceKm)).toFixed(0)} km
                    </span>
                  )}
                  {race.elevationM && (
                    <span className="flex items-center gap-1">
                      ⛰️ {race.elevationM}m ↑
                    </span>
                  )}
                  {race.profileType && (
                    <span className="flex items-center gap-1 capitalize">
                      {getProfileIcon(race.profileType)} {race.profileType}
                    </span>
                  )}
                  {race.raceType === "one_day" && discipline !== "mtb" && <span>🏁 One-day classic</span>}
                  {race.raceType === "stage_race" && <span>📅 Stage race</span>}
                  {(race.startTime || event.externalLinks?.raceStart) && (
                    <span>🕐 Start {race.startTime ? race.startTime.substring(0, 5) : event.externalLinks!.raceStart} local</span>
                  )}
                  {event.externalLinks?.raceFinish && (
                    <span>🏁 Est. finish {event.externalLinks.raceFinish}</span>
                  )}
                </div>

                {/* External links (website, social, streaming) */}
                {event.externalLinks && Object.keys(event.externalLinks).length > 0 && (
                  <RaceLinksSection links={event.externalLinks} />
                )}

                {/* Source PDF + Telegram subscribe */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {(race.startlistUrl || event.sourceUrl) && (
                    <a href={race.startlistUrl || event.sourceUrl || ""} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:text-blue-400 hover:underline inline-flex items-center gap-1">
                      View source PDF ↗
                    </a>
                  )}
                  <FollowButton followType="race" entityId={race.id} entityName={`${event.name} – ${race.gender === "men" ? "M" : "F"}${race.ageCategory === "elite" ? "" : race.ageCategory === "u23" ? " U23" : race.ageCategory === "junior" ? " Junior" : ""}`} />
                  <WhatsAppJoinButton />
                </div>

              </div>{/* /left */}

              {/* ── Right: weather card ──────────────── */}
              {weather && (() => {
                const wx = wmoToEmoji(weather.weatherCode);
                return (
                  <div className="lg:w-60 shrink-0">
                    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Race Day</span>
                        <span className="text-xs text-muted-foreground">{weather.city}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-4xl">{wx.emoji}</span>
                        <div>
                          <p className="text-lg font-bold">{weather.tempMax}° / {weather.tempMin}°C</p>
                          <p className="text-sm text-muted-foreground">{wx.desc}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/30">
                        <div className="text-xs">
                          <p className="text-muted-foreground">💧 Rain</p>
                          <p className="font-semibold">{weather.precipMm} mm</p>
                        </div>
                        <div className="text-xs">
                          <p className="text-muted-foreground">💨 Wind</p>
                          <p className="font-semibold">{weather.windKmh} km/h</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>{/* /flex row */}
          </div>
        </section>

        {/* ── Race Pulse: Latest News ─────────────────────────────────── */}
        {latestNews.length > 0 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-lg font-bold mb-4">📰 Race Pulse</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {latestNews.map((article) => (
                  <a
                    key={article.id}
                    href={article.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col rounded-xl border border-border/50 bg-card/30 hover:bg-card/80 hover:border-border transition-all overflow-hidden"
                  >
                    {article.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <div className="h-36 overflow-hidden bg-muted/30 shrink-0">
                        <img
                          src={article.imageUrl}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    )}
                    <div className="p-3 flex flex-col gap-1.5 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/70">
                          {article.source}
                        </span>
                        {article.publishedAt && (
                          <span className="text-[10px] text-muted-foreground/60">
                            · {formatDistanceToNow(article.publishedAt, { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-snug line-clamp-3 group-hover:text-primary transition-colors">
                        {article.title}
                      </p>
                      {article.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-auto pt-1">
                          {article.summary}
                        </p>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}



        {/* ── Pre-Race Intel ──────────────────────────────────────────── */}
        {raceIntel.length > 0 && !isCompleted && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-lg font-bold mb-4">Pre-Race Intel</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {raceIntel.slice(0, 6).map(({ rider, rumour }) => {
                  const score = parseFloat(rumour.aggregateScore || "0");
                  const sentiment = score > 0.3 ? { label: "FORM ✓", cls: "bg-green-500/15 text-green-400" }
                    : score < -0.3 ? { label: "DOUBT", cls: "bg-red-500/15 text-red-400" }
                    : { label: "NEUTRAL", cls: "bg-muted/50 text-muted-foreground" };
                  return (
                    <div key={rumour.id} className="rounded-lg border border-border/50 p-3 space-y-2 bg-card/30 hover:bg-card/60 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm shrink-0">{countryToFlag(rider.nationality)}</span>
                          <Link href={`/riders/${rider.id}`} className="font-medium text-sm truncate hover:text-primary transition-colors">
                            {rider.name}
                          </Link>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${sentiment.cls}`}>
                          {sentiment.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-3">{rumour.summary}</p>
                      {rumour.tipCount && rumour.tipCount > 1 && (
                        <p className="text-[10px] text-muted-foreground/50">{rumour.tipCount} sources</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Course ──────────────────────────────────────────────────── */}
        {race.pcsUrl && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">🗺️ Course</h2>
                <a href={race.pcsUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline">
                  View on ProCyclingStats →
                </a>
              </div>
              {/* Course info card */}
              <div className="rounded-lg border border-border/30 bg-muted/20 p-4 text-sm text-muted-foreground">
                <p>Course profile and race maps available on ProCyclingStats.</p>
                {race.raceType === "one_day" && discipline !== "mtb" && race.distanceKm && (
                  <p className="mt-1">📏 {parseFloat(String(race.distanceKm)).toFixed(0)} km one-day race</p>
                )}
              </div>
              {/* Other categories */}
              {siblingRaces.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground mb-2">Other categories in this event:</p>
                  <div className="flex flex-wrap gap-2">
                    {siblingRaces.map((sibling) => (
                      <Link key={sibling.id} href={sibling.href}
                        className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors">
                        <Badge variant="outline" className="text-xs">
                          {formatCategoryDisplay(sibling.ageCategory || "elite", sibling.gender || "men")}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Results Pending Banner ──────────────────────────────────── */}
        {!isCompleted && !isUpcoming && !isLive && raceDate <= new Date() && (
          <section className="border-b border-amber-500/30 bg-amber-500/5">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-4">
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                <span className="text-xl">⏳</span>
                <div>
                  <p className="font-semibold text-sm">Results pending</p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
                    {race.startTime
                      ? `Race started at ${race.startTime.substring(0, 5)} local time — results usually arrive within 1–2 hours of the finish.`
                      : "The race has finished — results are usually published within 1–2 hours. Predictions shown below."}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Tabs: Results / Startlist / Top Contenders ────────────── */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">
        <Tabs defaultValue={isCompleted ? "results" : "startlist"} className="space-y-6">
          <TabsList>
            {isCompleted && (
              <TabsTrigger value="results">
                Results ({results.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="startlist">
              Startlist ({startlist.length})
            </TabsTrigger>
            {(formattedPredictions.length > 0 || race.postRaceAnalysis) && (
              <TabsTrigger value="predictions">
                {isCompleted ? "Predictions & Analysis" : `Top Contenders (${formattedPredictions.length})`}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Results Tab */}
          {isCompleted && (
            <TabsContent value="results">
              {results.length > 0 ? (
                <div className="border rounded-lg divide-y">
                  {results.map(({ result, rider, team }) => (
                    <Link
                      key={result.id}
                      href={`/riders/${rider.id}`}
                      className="flex items-center gap-3 py-2 px-3 hover:bg-muted/50 rounded-lg transition-colors"
                    >
                      {/* Position */}
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          result.dnf || result.dns
                            ? "bg-muted text-muted-foreground"
                            : result.position === 1
                            ? "bg-yellow-500 text-yellow-950"
                            : result.position === 2
                            ? "bg-gray-300 text-gray-800"
                            : result.position === 3
                            ? "bg-amber-600 text-amber-50"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {result.dnf ? "DNF" : result.dns ? "DNS" : result.position || "–"}
                      </div>

                      {/* Name, Flag & Team */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate hover:underline">{rider.name}</span>
                          {rider.nationality && (
                            <span className="text-sm flex-shrink-0" title={rider.nationality}>
                              {countryToFlag(rider.nationality)}
                            </span>
                          )}
                          {rider.birthDate && (
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {calculateAge(rider.birthDate)}y
                            </span>
                          )}
                        </div>
                        {team && (
                          <div className="text-xs text-muted-foreground truncate">{team.name}</div>
                        )}
                      </div>

                      {/* Time */}
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">Time</div>
                        <div className="font-semibold text-sm tabular-nums">
                          {result.timeSeconds && !result.dnf && !result.dns ? (
                            result.position === 1 ? (
                              `${Math.floor(result.timeSeconds / 3600)}:${String(Math.floor((result.timeSeconds % 3600) / 60)).padStart(2, '0')}:${String(result.timeSeconds % 60).padStart(2, '0')}`
                            ) : result.timeGapSeconds ? (
                              `+${Math.floor(result.timeGapSeconds / 60)}:${String(result.timeGapSeconds % 60).padStart(2, '0')}`
                            ) : (
                              `${Math.floor(result.timeSeconds / 3600)}:${String(Math.floor((result.timeSeconds % 3600) / 60)).padStart(2, '0')}:${String(result.timeSeconds % 60).padStart(2, '0')}`
                            )
                          ) : "–"}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">No results available yet.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          <TabsContent value="startlist">
            {startlist.length > 0 ? (
              <div className="border rounded-lg divide-y">
                {(() => {
                  // ── ROAD: group by team (only if team data exists) ─────
                  const hasTeamData = startlist.some(row => row.team?.name);
                  if (discipline === "road" && !isSuperCup && hasTeamData) {
                    const byTeam = startlist.reduce<Record<string, typeof startlist>>((acc, row) => {
                      const key = row.team?.name || "Unknown Team";
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(row);
                      return acc;
                    }, {});
                    const sortedTeams = Object.entries(byTeam).sort(([a], [b]) => a.localeCompare(b));

                    return sortedTeams.map(([teamName, teamRiders]) => (
                      <div key={teamName}>
                        {/* Team header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <span className="truncate">{teamName}</span>
                          <span className="ml-auto shrink-0 font-normal normal-case">{teamRiders.length} riders</span>
                        </div>
                        {/* Riders in team */}
                        {teamRiders.map(({ entry, rider, stats }) => (
                          <Link key={entry.id} href={`/riders/${rider.id}`}
                            className="flex items-center gap-3 py-2 px-3 pl-7 hover:bg-muted/50 transition-colors">
                            <div className="w-6 text-center text-xs text-muted-foreground shrink-0">
                              {entry.bibNumber || "–"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {rider.nationality && (
                                  <span className="text-sm shrink-0">{countryToFlag(rider.nationality)}</span>
                                )}
                                <span className="font-medium truncate text-sm">{rider.name}</span>
                                {rider.birthDate && (
                                  <span className="text-xs text-muted-foreground shrink-0">{calculateAge(rider.birthDate)}y</span>
                                )}
                              </div>
                            </div>

                          </Link>
                        ))}
                      </div>
                    ));
                  }

                  // ── FLAT LIST (MTB / SuperCup) ─────────────────────────
                  const sortedStartlist = isSuperCup
                    ? [...startlist].sort((a, b) => {
                        const aUci = a.stats?.uciPoints ?? 0;
                        const bUci = b.stats?.uciPoints ?? 0;
                        if (aUci !== bUci) return bUci - aUci;
                        const aSc = a.stats?.supercupPoints ?? 0;
                        const bSc = b.stats?.supercupPoints ?? 0;
                        return bSc - aSc;
                      })
                    : startlist;

                  return sortedStartlist.map(({ entry, rider, team, stats }, index) => (
                    <Link
                      key={entry.id}
                      href={`/riders/${rider.id}`}
                      className="flex items-center gap-3 py-2 px-3 hover:bg-muted/50 rounded-lg transition-colors"
                    >
                      {/* Position badge for SuperCup / Bib for others */}
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        isSuperCup
                          ? index === 0
                            ? "bg-yellow-500 text-yellow-950"
                            : index === 1
                            ? "bg-gray-300 text-gray-800"
                            : index === 2
                            ? "bg-amber-600 text-amber-50"
                            : "bg-muted text-muted-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {isSuperCup ? index + 1 : entry.bibNumber || "–"}
                      </div>

                      {/* Name, Flag & Team */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate hover:underline">{rider.name}</span>
                          {rider.nationality && (
                            <span className="text-sm flex-shrink-0" title={rider.nationality}>
                              {countryToFlag(rider.nationality)}
                            </span>
                          )}
                          {rider.birthDate && (
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {calculateAge(rider.birthDate)}y
                            </span>
                          )}
                        </div>
                        {team && (
                          <div className="text-xs text-muted-foreground truncate">{team.name}</div>
                        )}
                      </div>

                      {/* UCI points column */}
                      <div className="w-14 text-right shrink-0">
                        <div className="text-xs text-muted-foreground">UCI</div>
                        <div className="font-semibold text-sm">{stats?.uciPoints ? stats.uciPoints : "—"}</div>
                      </div>

                      {/* SC column for SuperCup races only */}
                      {isSuperCup && (
                        <div className="w-14 text-right shrink-0">
                          <div className="text-xs text-muted-foreground">SC</div>
                          <div className="font-semibold text-sm">{stats?.supercupPoints ? stats.supercupPoints : "—"}</div>
                        </div>
                      )}


                    </Link>
                  ));
                })()}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">Startlist not yet available.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Top Contenders / Race Analysis Tab */}
          <TabsContent value="predictions">
            {isCompleted && race.postRaceAnalysis ? (
              /* Completed race: show analysis + predictions side by side */
              <div className="space-y-6">
                {/* Post-race analysis */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">🏁</span>
                      <h3 className="font-semibold text-sm uppercase tracking-wide text-primary">Race Analysis</h3>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{race.postRaceAnalysis}</p>
                    {race.analysisGeneratedAt && (
                      <p className="text-xs text-muted-foreground mt-3">
                        Analysis generated {new Date(race.analysisGeneratedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    )}
                  </CardContent>
                </Card>
                {/* Pre-race predictions for reference */}
                {formattedPredictions.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">Pre-race predictions for reference:</p>
                    <PredictionList predictions={formattedPredictions} isSuperCup={isSuperCup} />
                  </div>
                )}
              </div>
            ) : !isCompleted ? (
              formattedPredictions.length > 0 ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-4">Top contenders ranked by predicted race performance.</p>
                  <PredictionList predictions={formattedPredictions} isSuperCup={isSuperCup} />
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">
                      {startlist.length === 0
                        ? "No contenders available yet. Add riders to the startlist to generate predictions."
                        : "Contenders are being calculated. Refresh the page to see them."}
                    </p>
                  </CardContent>
                </Card>
              )
            ) : (
              /* Completed but no analysis yet */
              formattedPredictions.length > 0 ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-4">Pre-race predictions:</p>
                  <PredictionList predictions={formattedPredictions} isSuperCup={isSuperCup} />
                </div>
              ) : null
            )}
          </TabsContent>
        </Tabs>
        </div>{/* /tabs container */}

        {/* ── HOW TO WATCH ─────────────────────────────────────────────── */}
        {event.externalLinks?.tvSchedule && event.externalLinks.tvSchedule.length > 0 && (
          <section className="border-t border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-lg font-bold mb-4">How to Watch</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {event.externalLinks.tvSchedule.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">{entry.region}</p>
                      {entry.url ? (
                        <a href={entry.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-semibold hover:text-primary transition-colors truncate block">
                          {entry.channel}
                        </a>
                      ) : (
                        <p className="text-sm font-semibold truncate">{entry.channel}</p>
                      )}
                    </div>
                    {entry.startTime && (
                      <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
                        {entry.startTime}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
