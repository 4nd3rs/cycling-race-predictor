import { notFound } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { Header } from "@/components/header";
import { PredictionList } from "@/components/prediction-card";
import { RefreshStartlistButton } from "@/components/refresh-startlist-button";
import { ReimportResultsButton } from "@/components/reimport-results-button";
import { SyncSupercupButton } from "@/components/sync-supercup-button";
import { AddInfoButton } from "@/components/add-info-button";
import { DeleteRaceButton } from "@/components/delete-race-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, races, predictions, riders, raceStartlist, riderDisciplineStats, raceResults, riderRumours, teams, raceEvents } from "@/lib/db";
import { eq, desc, and, gte, ne } from "drizzle-orm";
import { format } from "date-fns";
import { generateRacePredictions, calculateForm, type RiderPredictionInput, type RecentResult, RACE_CATEGORY_WEIGHTS, type ProfileType } from "@/lib/prediction";
import { formatCategoryDisplay } from "@/lib/category-utils";
import {
  isValidDiscipline,
  getDisciplineLabel,
  getSubDisciplineShortLabel,
  parseCategorySlug,
  buildCategoryUrl,
  generateCategorySlug,
} from "@/lib/url-utils";

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
    // Try to find by category_slug first
    let [race] = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.raceEventId, eventId),
          eq(races.categorySlug, categorySlug)
        )
      )
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
        .limit(1);
    }

    return race;
  } catch {
    return null;
  }
}

async function getRacePredictions(raceId: string, race: typeof races.$inferSelect) {
  try {
    const isMtbRace = race.discipline === "mtb";

    // Get predictions with rider and stats
    const results = await db
      .select({
        prediction: predictions,
        rider: riders,
        stats: riderDisciplineStats,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .leftJoin(
        riderDisciplineStats,
        isMtbRace
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
      .where(eq(predictions.raceId, raceId));

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
              eq(riderDisciplineStats.ageCategory, race?.ageCategory || "elite")
            )
          : and(
              eq(riderDisciplineStats.riderId, riders.id),
              eq(riderDisciplineStats.discipline, race?.discipline || "road")
            )
      )
      .where(eq(raceStartlist.raceId, raceId))
      .orderBy(raceStartlist.bibNumber);

    return results;
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

    console.log(`Generated ${result.predictions.length} predictions for race ${race.id}`);
  } catch (error) {
    console.error("Error generating predictions:", error);
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
  const admin = await isAdmin();

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

  // Get startlist (with stats for point-based sorting)
  const startlist = await getRaceStartlist(race.id, race);

  // Get sibling races
  const siblingRaces = await getSiblingRaces(event.id, race.id, discipline, eventSlug);

  // Generate predictions if needed
  if (startlist.length > 0 && !isCompleted) {
    await generatePredictionsIfNeeded(race, startlist.length);
  }

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
        teamName: teamName || undefined,
        predictedPosition: prediction.predictedPosition || 0,
        winProbability: hasEnoughData ? parseFloat(prediction.winProbability || "0") : 0,
        podiumProbability: hasEnoughData ? parseFloat(prediction.podiumProbability || "0") : 0,
        top10Probability: hasEnoughData ? parseFloat(prediction.top10Probability || "0") : 0,
        reasoning: prediction.reasoning || undefined,
        uciPoints: stats?.uciPoints ? parseInt(String(stats.uciPoints)) : 0,
        uciRank: stats?.uciRank || null,
        supercupPoints: stats?.supercupPoints ? parseInt(String(stats.supercupPoints)) : 0,
        eloScore: stats?.racesTotal
          ? Math.round(parseFloat(stats.currentElo || "0"))
          : undefined,
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

  const raceDate = new Date(race.date);
  const isUpcoming = raceDate > new Date() && !isCompleted;
  const disciplineLabel = getDisciplineLabel(discipline);
  const categoryDisplay = formatCategoryDisplay(race.ageCategory || "elite", race.gender || "men");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <Link href="/races" className="text-muted-foreground hover:text-foreground">
            Races
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link href={`/races/${discipline}`} className="text-muted-foreground hover:text-foreground">
            {disciplineLabel}
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link href={`/races/${discipline}/${eventSlug}`} className="text-muted-foreground hover:text-foreground">
            {event.name}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{categoryDisplay}</span>
        </div>

        {/* Race Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant="secondary">{disciplineLabel}</Badge>
                {event.subDiscipline && (
                  <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                    {getSubDisciplineShortLabel(event.subDiscipline)}
                  </Badge>
                )}
                <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                  {categoryDisplay}
                </Badge>
                {race.profileType && (
                  <Badge variant="outline">
                    {getProfileIcon(race.profileType)} {race.profileType}
                  </Badge>
                )}
                {race.uciCategory && (
                  <Badge variant="outline">{race.uciCategory}</Badge>
                )}
                {isUpcoming ? (
                  <Badge className="bg-green-500">Upcoming</Badge>
                ) : (
                  <Badge variant="secondary">Completed</Badge>
                )}
              </div>
              <h1 className="text-3xl font-bold">{event.name}</h1>
              <p className="text-xl text-muted-foreground">{categoryDisplay}</p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-muted-foreground">
                <span>{format(raceDate, "EEEE, MMMM d, yyyy")}</span>
                {race.country && (
                  <span className="flex items-center gap-1">
                    {countryToFlag(race.country)} {race.country}
                  </span>
                )}
                {race.distanceKm && (
                  <span>• {parseFloat(race.distanceKm).toFixed(1)} km</span>
                )}
                {race.elevationM && <span>• {race.elevationM}m ↑</span>}
              </div>
            </div>
            {admin && (
              <div className="flex flex-wrap gap-2">
                {discipline === "mtb" && isSuperCup && <SyncSupercupButton raceId={race.id} />}
                {discipline === "mtb" && (
                  <AddInfoButton raceId={race.id} raceName={`${event.name} - ${categoryDisplay}`} />
                )}
                {!isCompleted && event.sourceType !== "cronomancha" && event.sourceType !== "copa_catalana" && (
                  <RefreshStartlistButton raceId={race.id} />
                )}
                {isCompleted && event.sourceType === "copa_catalana" && (
                  <ReimportResultsButton raceId={race.id} />
                )}
                <DeleteRaceButton raceId={race.id} raceName={race.name} />
              </div>
            )}
          </div>

          {/* Source link */}
          {(race.startlistUrl || event.sourceUrl) && (
            <div className="mt-2">
              <a
                href={race.startlistUrl || event.sourceUrl || ""}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                View source PDF ↗
              </a>
            </div>
          )}

          {/* Related category races */}
          {siblingRaces.length > 0 && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">Other categories in this event:</p>
              <div className="flex flex-wrap gap-2">
                {siblingRaces.map((sibling) => (
                  <Link
                    key={sibling.id}
                    href={sibling.href}
                    className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded bg-background hover:bg-muted transition-colors"
                  >
                    <Badge variant="outline" className="text-xs">
                      {formatCategoryDisplay(sibling.ageCategory || "elite", sibling.gender || "men")}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

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
            {!isCompleted && (
              <TabsTrigger value="predictions">
                Predictions ({formattedPredictions.length})
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
                  // For SuperCup races, sort by UCI points desc -> SuperCup points desc
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

                      {/* ELO column */}
                      <div className="w-14 text-right shrink-0">
                        <div className="text-xs text-muted-foreground">ELO</div>
                        <div className="font-semibold text-sm">
                          {stats?.racesTotal ? Math.round(parseFloat(stats.currentElo || "0")) : "—"}
                        </div>
                      </div>
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

          {/* Predictions Tab */}
          {!isCompleted && (
            <TabsContent value="predictions">
              {formattedPredictions.length > 0 ? (
                <PredictionList predictions={formattedPredictions} isSuperCup={isSuperCup} />
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">
                      {startlist.length === 0
                        ? "No predictions available yet. Add riders to the startlist to generate predictions."
                        : "Predictions are being generated. Refresh the page to see them."}
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
