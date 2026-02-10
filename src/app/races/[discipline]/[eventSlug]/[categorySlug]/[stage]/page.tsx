import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { db, races, raceEvents, raceResults, riders, teams, riderDisciplineStats } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";
import {
  isValidDiscipline,
  getDisciplineLabel,
  getSubDisciplineShortLabel,
  parseCategorySlug,
  buildCategoryUrl,
} from "@/lib/url-utils";
import { formatCategoryDisplay } from "@/lib/category-utils";

interface PageProps {
  params: Promise<{
    discipline: string;
    eventSlug: string;
    categorySlug: string;
    stage: string;
  }>;
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

async function getParentRace(eventId: string, categorySlug: string) {
  const parsed = parseCategorySlug(categorySlug);
  if (!parsed) return null;

  try {
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

async function getStageRace(parentRaceId: string, stageNumber: number) {
  try {
    const [stage] = await db
      .select()
      .from(races)
      .where(
        and(
          eq(races.parentRaceId, parentRaceId),
          eq(races.stageNumber, stageNumber)
        )
      )
      .limit(1);
    return stage;
  } catch {
    return null;
  }
}

async function getStageResults(raceId: string, discipline: string) {
  try {
    const results = await db
      .select({
        result: raceResults,
        rider: riders,
        team: teams,
      })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .leftJoin(
        riderDisciplineStats,
        and(
          eq(riderDisciplineStats.riderId, riders.id),
          eq(riderDisciplineStats.discipline, discipline)
        )
      )
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(eq(raceResults.raceId, raceId));

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

async function getAllStages(parentRaceId: string) {
  try {
    const stages = await db
      .select({
        id: races.id,
        stageNumber: races.stageNumber,
        name: races.name,
        date: races.date,
      })
      .from(races)
      .where(eq(races.parentRaceId, parentRaceId))
      .orderBy(races.stageNumber);
    return stages;
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

export default async function StagePage({ params }: PageProps) {
  const { discipline, eventSlug, categorySlug, stage } = await params;

  // Validate discipline
  if (!isValidDiscipline(discipline)) {
    notFound();
  }

  // Parse stage number (e.g., "stage-5" -> 5)
  const stageMatch = stage.match(/^stage-(\d+)$/);
  if (!stageMatch) {
    notFound();
  }
  const stageNumber = parseInt(stageMatch[1], 10);

  // Get event
  const event = await getEventBySlug(discipline, eventSlug);
  if (!event) {
    notFound();
  }

  // Get parent race (the stage race category)
  const parentRace = await getParentRace(event.id, categorySlug);
  if (!parentRace) {
    notFound();
  }

  // Get the specific stage
  const stageRace = await getStageRace(parentRace.id, stageNumber);
  if (!stageRace) {
    // Stage not found, redirect to category page
    redirect(buildCategoryUrl(discipline, eventSlug, categorySlug));
  }

  // Get stage results
  const results = await getStageResults(stageRace.id, stageRace.discipline);

  // Get all stages for navigation
  const allStages = await getAllStages(parentRace.id);

  const disciplineLabel = getDisciplineLabel(discipline);
  const categoryDisplay = formatCategoryDisplay(
    parentRace.ageCategory || "elite",
    parentRace.gender || "men"
  );
  const stageDate = new Date(stageRace.date);

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
          <Link
            href={buildCategoryUrl(discipline, eventSlug, categorySlug)}
            className="text-muted-foreground hover:text-foreground"
          >
            {categoryDisplay}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Stage {stageNumber}</span>
        </div>

        {/* Stage Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">{disciplineLabel}</Badge>
            {event.subDiscipline && (
              <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">
                {getSubDisciplineShortLabel(event.subDiscipline)}
              </Badge>
            )}
            <Badge variant="outline">{categoryDisplay}</Badge>
            <Badge>Stage {stageNumber}</Badge>
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {stageRace.name || `Stage ${stageNumber}`}
          </h1>
          <p className="text-xl text-muted-foreground">{event.name}</p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-muted-foreground">
            <span>{format(stageDate, "EEEE, MMMM d, yyyy")}</span>
            {stageRace.country && (
              <span className="flex items-center gap-1">
                {countryToFlag(stageRace.country)} {stageRace.country}
              </span>
            )}
            {stageRace.distanceKm && (
              <span>• {parseFloat(stageRace.distanceKm).toFixed(1)} km</span>
            )}
            {stageRace.elevationM && <span>• {stageRace.elevationM}m ↑</span>}
          </div>
        </div>

        {/* Stage Navigation */}
        {allStages.length > 1 && (
          <div className="mb-6 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Stages:</p>
            <div className="flex flex-wrap gap-2">
              {allStages.map((s) => (
                <Link
                  key={s.id}
                  href={`/races/${discipline}/${eventSlug}/${categorySlug}/stage-${s.stageNumber}`}
                  className={`px-3 py-1 rounded text-sm ${
                    s.stageNumber === stageNumber
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted transition-colors"
                  }`}
                >
                  Stage {s.stageNumber}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[3rem_1fr_auto] md:grid-cols-[3rem_2fr_1fr_6rem] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <div>Pos</div>
              <div>Rider</div>
              <div className="hidden md:block">Team</div>
              <div className="text-right">Time</div>
            </div>
            <div className="divide-y">
              {results.map(({ result, rider, team }, index) => (
                <div
                  key={result.id}
                  className={`grid grid-cols-[3rem_1fr_auto] md:grid-cols-[3rem_2fr_1fr_6rem] gap-2 px-3 py-2 text-sm hover:bg-muted/30 transition-colors ${
                    index % 2 === 0 ? "" : "bg-muted/20"
                  }`}
                >
                  <div className={`font-bold ${
                    result.position === 1 ? "text-yellow-600 dark:text-yellow-400" :
                    result.position === 2 ? "text-gray-500 dark:text-gray-400" :
                    result.position === 3 ? "text-orange-600 dark:text-orange-400" : ""
                  }`}>
                    {result.dnf ? "DNF" : result.dns ? "DNS" : result.position || "–"}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    {rider.nationality && (
                      <span className="text-sm flex-shrink-0" title={rider.nationality}>
                        {countryToFlag(rider.nationality)}
                      </span>
                    )}
                    <Link href={`/riders/${rider.id}`} className="hover:underline truncate">
                      {rider.name}
                    </Link>
                  </div>
                  <div className="hidden md:block text-muted-foreground truncate">
                    {team?.name || "–"}
                  </div>
                  <div className="text-right tabular-nums text-muted-foreground">
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
              ))}
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No results available for this stage yet.</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
