import { Suspense } from "react";
import { isAdmin } from "@/lib/auth";
import { Header } from "@/components/header";
import { RaceCard, RaceList } from "@/components/race-card";
import { EventCard, EventList } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db, races, raceEvents, raceStartlist } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import {
  VALID_DISCIPLINES,
  getDisciplineLabel,
  getDisciplineShortLabel,
  type Discipline,
} from "@/lib/url-utils";

interface GroupedEvent {
  id: string;
  name: string;
  slug: string | null;
  date: string;
  endDate: string | null;
  country: string | null;
  discipline: string;
  subDiscipline: string | null;
  categories: Array<{
    id: string;
    ageCategory: string;
    gender: string;
    categorySlug: string | null;
    riderCount: number;
  }>;
}

interface StandaloneRace {
  id: string;
  name: string;
  date: string;
  country?: string;
  discipline: string;
  profileType?: string;
  uciCategory?: string;
  status: string;
}

async function getUpcomingRacesAndEvents() {
  const today = new Date().toISOString().split("T")[0];

  try {
    // Get races that are part of events (upcoming based on event date)
    const eventRaces = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(gte(raceEvents.date, today))
      .orderBy(raceEvents.date);

    // Get standalone races (no event)
    const standaloneRaces = await db
      .select()
      .from(races)
      .where(
        and(
          gte(races.date, today),
          eq(races.status, "active"),
          isNull(races.raceEventId)
        )
      )
      .orderBy(races.date)
      .limit(50);

    // Group event races by event ID
    const eventsMap = new Map<string, GroupedEvent>();
    for (const { race, event, startlistCount, resultCount } of eventRaces) {
      if (!eventsMap.has(event.id)) {
        eventsMap.set(event.id, {
          id: event.id,
          name: event.name,
          slug: event.slug,
          date: event.date,
          endDate: event.endDate,
          country: event.country,
          discipline: event.discipline,
          subDiscipline: event.subDiscipline,
          categories: [],
        });
      }
      // Use max of startlist or results count
      const riderCount = Math.max(Number(startlistCount) || 0, Number(resultCount) || 0);
      eventsMap.get(event.id)!.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount,
      });
    }

    return {
      events: Array.from(eventsMap.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
      standaloneRaces: standaloneRaces.map((race) => ({
        id: race.id,
        name: race.name,
        date: race.date,
        country: race.country || undefined,
        discipline: race.discipline,
        profileType: race.profileType || undefined,
        uciCategory: race.uciCategory || undefined,
        status: race.status || "active",
      })),
    };
  } catch (error) {
    console.error("Error fetching races:", error);
    return { events: [], standaloneRaces: [] };
  }
}

async function getRecentRacesAndEvents() {
  const today = new Date().toISOString().split("T")[0];

  try {
    // Get races that are part of events (past based on event date)
    const eventRaces = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(lt(raceEvents.date, today))
      .orderBy(desc(raceEvents.date))
      .limit(100);

    // Get standalone races (no event)
    const standaloneRaces = await db
      .select()
      .from(races)
      .where(
        and(
          lt(races.date, today),
          isNull(races.raceEventId)
        )
      )
      .orderBy(desc(races.date))
      .limit(50);

    // Group event races by event ID
    const eventsMap = new Map<string, GroupedEvent>();
    for (const { race, event, startlistCount, resultCount } of eventRaces) {
      if (!eventsMap.has(event.id)) {
        eventsMap.set(event.id, {
          id: event.id,
          name: event.name,
          slug: event.slug,
          date: event.date,
          endDate: event.endDate,
          country: event.country,
          discipline: event.discipline,
          subDiscipline: event.subDiscipline,
          categories: [],
        });
      }
      // Use max of startlist or results count
      const riderCount = Math.max(Number(startlistCount) || 0, Number(resultCount) || 0);
      eventsMap.get(event.id)!.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount,
      });
    }

    return {
      events: Array.from(eventsMap.values()).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
      standaloneRaces: standaloneRaces.map((race) => ({
        id: race.id,
        name: race.name,
        date: race.date,
        country: race.country || undefined,
        discipline: race.discipline,
        profileType: race.profileType || undefined,
        uciCategory: race.uciCategory || undefined,
        status: race.status || "completed",
      })),
    };
  } catch (error) {
    console.error("Error fetching races:", error);
    return { events: [], standaloneRaces: [] };
  }
}

function RaceListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-48 rounded-lg bg-muted animate-pulse"
        />
      ))}
    </div>
  );
}

async function UpcomingRacesSection() {
  const { events, standaloneRaces } = await getUpcomingRacesAndEvents();

  if (events.length === 0 && standaloneRaces.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No upcoming races found. Add a race to get started!
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Events (grouped races) */}
      {events.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Events</h2>
          <EventList events={events} />
        </div>
      )}

      {/* Standalone races */}
      {standaloneRaces.length > 0 && (
        <div>
          {events.length > 0 && (
            <h2 className="text-lg font-semibold mb-4">Individual Races</h2>
          )}
          <RaceList races={standaloneRaces} />
        </div>
      )}
    </div>
  );
}

async function RecentRacesSection() {
  const { events, standaloneRaces } = await getRecentRacesAndEvents();

  if (events.length === 0 && standaloneRaces.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No past races found.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Events (grouped races) */}
      {events.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Events</h2>
          <EventList events={events} />
        </div>
      )}

      {/* Standalone races */}
      {standaloneRaces.length > 0 && (
        <div>
          {events.length > 0 && (
            <h2 className="text-lg font-semibold mb-4">Individual Races</h2>
          )}
          <RaceList races={standaloneRaces} />
        </div>
      )}
    </div>
  );
}

// Discipline icons
const DISCIPLINE_ICONS: Record<string, string> = {
  mtb: "🚵",
  road: "🚴",
  gravel: "🏔️",
  cyclocross: "🔄",
};

// Get counts for each discipline
async function getDisciplineCounts() {
  const today = new Date().toISOString().split("T")[0];

  const counts: Record<string, { upcoming: number; total: number }> = {};

  for (const discipline of VALID_DISCIPLINES) {
    try {
      const upcomingCount = await db
        .select({ count: sql<number>`count(distinct ${raceEvents.id})` })
        .from(raceEvents)
        .where(
          and(eq(raceEvents.discipline, discipline), gte(raceEvents.date, today))
        );

      const totalCount = await db
        .select({ count: sql<number>`count(distinct ${raceEvents.id})` })
        .from(raceEvents)
        .where(eq(raceEvents.discipline, discipline));

      counts[discipline] = {
        upcoming: Number(upcomingCount[0]?.count) || 0,
        total: Number(totalCount[0]?.count) || 0,
      };
    } catch {
      counts[discipline] = { upcoming: 0, total: 0 };
    }
  }

  return counts;
}

function DisciplineCard({
  discipline,
  upcoming,
  total,
}: {
  discipline: Discipline;
  upcoming: number;
  total: number;
}) {
  return (
    <Link href={`/races/${discipline}`}>
      <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{DISCIPLINE_ICONS[discipline]}</span>
            <div>
              <CardTitle className="text-xl">{getDisciplineLabel(discipline)}</CardTitle>
              <Badge variant="secondary" className="mt-1">
                {getDisciplineShortLabel(discipline)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {upcoming > 0 && (
              <span className="text-green-600 dark:text-green-400 font-medium">
                {upcoming} upcoming
              </span>
            )}
            <span>{total} total events</span>
          </div>
          <div className="mt-3 text-sm text-blue-600 dark:text-blue-400">
            Browse events →
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

async function DisciplinesSection() {
  const counts = await getDisciplineCounts();

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
      {VALID_DISCIPLINES.map((discipline) => (
        <DisciplineCard
          key={discipline}
          discipline={discipline}
          upcoming={counts[discipline]?.upcoming || 0}
          total={counts[discipline]?.total || 0}
        />
      ))}
    </div>
  );
}

export default async function RacesPage() {
  const admin = await isAdmin();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Races</h1>
            <p className="text-muted-foreground mt-1">
              Browse cycling events by discipline
            </p>
          </div>
          {admin && (
            <Button asChild>
              <Link href="/races/new">+ Add Race</Link>
            </Button>
          )}
        </div>

        {/* Discipline Cards */}
        <Suspense
          fallback={
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          }
        >
          <DisciplinesSection />
        </Suspense>

        {/* Recent Events */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">All Events</h2>
          <Tabs defaultValue="upcoming" className="space-y-6">
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="recent">Recent</TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming">
              <Suspense fallback={<RaceListSkeleton />}>
                <UpcomingRacesSection />
              </Suspense>
            </TabsContent>

            <TabsContent value="recent">
              <Suspense fallback={<RaceListSkeleton />}>
                <RecentRacesSection />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
