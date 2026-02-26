import Link from "next/link";
import { Header } from "@/components/header";
import { IntelCard } from "@/components/intel-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, races, raceEvents, raceStartlist, riderRumours, riders, raceResults } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull } from "drizzle-orm";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { getFlag } from "@/lib/country-flags";
import { buildRaceUrl, getDisciplineShortLabel } from "@/lib/url-utils";

// ---------------------------------------------------------------------------
// DATA FETCHING
// ---------------------------------------------------------------------------

async function getNextRace() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(gte(raceEvents.date, today), eq(races.status, "active")))
      .orderBy(raceEvents.date)
      .limit(1);

    return result[0] || null;
  } catch {
    return null;
  }
}

async function getUpcomingRaces() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(gte(raceEvents.date, today), eq(races.status, "active")))
      .orderBy(raceEvents.date)
      .limit(12);

    return result;
  } catch {
    return [];
  }
}

async function getLatestIntel() {
  try {
    const result = await db
      .select({
        rumour: riderRumours,
        rider: riders,
      })
      .from(riderRumours)
      .innerJoin(riders, eq(riderRumours.riderId, riders.id))
      .where(isNotNull(riderRumours.summary))
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(10);

    return result;
  } catch {
    return [];
  }
}

async function getRecentResults() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

  try {
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        winner: riders,
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(
        and(
          eq(raceResults.position, 1),
          gte(races.date, cutoff),
          lt(races.date, new Date().toISOString().split("T")[0])
        )
      )
      .orderBy(desc(races.date))
      .limit(8);

    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function getDisciplineColor(discipline: string) {
  switch (discipline) {
    case "road": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "mtb": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "cyclocross": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "gravel": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function getDisciplineLabel(discipline: string) {
  switch (discipline) {
    case "road": return "ROAD";
    case "mtb": return "MTB";
    case "cyclocross": return "CX";
    case "gravel": return "GRAVEL";
    default: return discipline.toUpperCase();
  }
}

function getRaceUrl(race: typeof races.$inferSelect, event: typeof raceEvents.$inferSelect) {
  return buildRaceUrl(race, event);
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

export default async function Home() {
  const [nextRace, upcomingRaces, latestIntel, recentResults] = await Promise.all([
    getNextRace(),
    getUpcomingRaces(),
    getLatestIntel(),
    getRecentResults(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* ---- NEXT RACE SPOTLIGHT ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 md:py-16">
            {nextRace ? (
              <NextRaceHero
                race={nextRace.race}
                event={nextRace.event}
                startlistCount={Number(nextRace.startlistCount) || 0}
              />
            ) : (
              <div className="text-center py-12">
                <p className="text-xl text-muted-foreground">No upcoming races — check back soon</p>
              </div>
            )}
          </div>
        </section>

        {/* ---- UPCOMING RACES GRID ---- */}
        {upcomingRaces.length > 1 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold tracking-tight">On the Calendar</h2>
                <Link href="/races" className="text-sm text-primary hover:text-primary/80 transition-colors">
                  View all races &rarr;
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingRaces.slice(1).map(({ race, event, startlistCount }) => (
                  <UpcomingRaceCard
                    key={race.id}
                    race={race}
                    event={event}
                    startlistCount={Number(startlistCount) || 0}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
          <div className="grid gap-10 lg:grid-cols-5">
            {/* ---- LATEST INTEL ---- */}
            <div className="lg:col-span-3">
              <h2 className="text-xl font-bold tracking-tight mb-6">
                Latest Intel
              </h2>
              {latestIntel.length > 0 ? (
                <div className="space-y-3">
                  {latestIntel.map(({ rumour, rider }) => (
                    <IntelCard
                      key={rumour.id}
                      riderId={rider.id}
                      riderName={rider.name}
                      summary={rumour.summary}
                      aggregateScore={rumour.aggregateScore}
                      tipCount={rumour.tipCount}
                      lastUpdated={rumour.lastUpdated}
                    />
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">No intel yet — check back after race season starts.</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ---- RECENT RESULTS ---- */}
            <div className="lg:col-span-2">
              <h2 className="text-xl font-bold tracking-tight mb-6">
                Latest Results
              </h2>
              {recentResults.length > 0 ? (
                <div className="space-y-2">
                  {recentResults.map(({ race, event, winner }) => (
                    <Link
                      key={race.id}
                      href={getRaceUrl(race, event)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-card transition-colors group"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-500 text-sm font-bold shrink-0">
                        1
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                          {event.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {winner.name} &middot; {format(new Date(race.date), "MMM d")}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${getDisciplineColor(event.discipline)}`}>
                        {getDisciplineLabel(event.discipline)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground text-sm">No recent results to show.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <p>
            Data from{" "}
            <a
              href="https://www.procyclingstats.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              ProCyclingStats
            </a>
          </p>
          <p>Built with Next.js, TrueSkill, and AI</p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

function NextRaceHero({
  race,
  event,
  startlistCount,
}: {
  race: typeof races.$inferSelect;
  event: typeof raceEvents.$inferSelect;
  startlistCount: number;
}) {
  const raceDate = new Date(race.date);
  const daysUntil = differenceInDays(raceDate, new Date());
  const url = getRaceUrl(race, event);

  const subLabel = event.subDiscipline
    ? getDisciplineShortLabel(event.subDiscipline)
    : null;

  return (
    <div className="relative">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              Next Race
            </span>
            {daysUntil >= 0 && daysUntil <= 7 && (
              <Badge className="bg-accent text-accent-foreground text-xs font-bold">
                {daysUntil === 0
                  ? "TODAY"
                  : daysUntil === 1
                  ? "TOMORROW"
                  : `IN ${daysUntil} DAYS`}
              </Badge>
            )}
          </div>

          <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">
            {event.name}
          </h1>

          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {getFlag(event.country)} {format(raceDate, "EEEE, MMMM d")}
            </span>
            <Badge variant="outline" className={getDisciplineColor(event.discipline)}>
              {getDisciplineLabel(event.discipline)}
              {subLabel ? ` ${subLabel}` : ""}
            </Badge>
            {race.uciCategory && (
              <Badge variant="outline" className="text-xs">
                {race.uciCategory}
              </Badge>
            )}
          </div>

          {startlistCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {startlistCount} riders confirmed
            </p>
          )}
        </div>

        <Button asChild size="lg" className="self-start md:self-end shrink-0">
          <Link href={url}>
            View Predictions &rarr;
          </Link>
        </Button>
      </div>

      {/* Racing stripe accent */}
      <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full hidden md:block" />
    </div>
  );
}

function UpcomingRaceCard({
  race,
  event,
  startlistCount,
}: {
  race: typeof races.$inferSelect;
  event: typeof raceEvents.$inferSelect;
  startlistCount: number;
}) {
  const raceDate = new Date(race.date);
  const url = getRaceUrl(race, event);

  return (
    <Link
      href={url}
      className="flex flex-col gap-2 p-4 rounded-lg border border-border/50 hover:border-border hover:bg-card transition-colors group"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={`text-[10px] shrink-0 ${getDisciplineColor(event.discipline)}`}>
          {getDisciplineLabel(event.discipline)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {format(raceDate, "MMM d")}
        </span>
      </div>
      <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
        {event.name}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{getFlag(event.country)}</span>
        {startlistCount > 0 && <span>{startlistCount} riders</span>}
      </div>
    </Link>
  );
}
