import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { EventCard, EventList } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { db, races, raceEvents } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull } from "drizzle-orm";
import {
  isValidDiscipline,
  getDisciplineLabel,
  getSubDisciplineShortLabel,
  buildEventUrl,
  type Discipline,
} from "@/lib/url-utils";
import { ImportHistoricalButton } from "@/components/import-historical-button";

interface PageProps {
  params: Promise<{ discipline: string }>;
}

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

async function getEventsByDiscipline(discipline: Discipline, upcoming: boolean) {
  const today = new Date().toISOString().split("T")[0];

  try {
    // Get races that are part of events for this discipline
    // Note: We don't filter by status since races can have results imported before the event date
    const eventRaces = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(
        and(
          eq(raceEvents.discipline, discipline),
          upcoming ? gte(raceEvents.date, today) : lt(raceEvents.date, today)
        )
      )
      .orderBy(upcoming ? raceEvents.date : desc(raceEvents.date))
      .limit(200);

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
      // Use max of startlist or results count (for past events, riders are in results)
      const riderCount = Math.max(Number(startlistCount) || 0, Number(resultCount) || 0);
      eventsMap.get(event.id)!.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount,
      });
    }

    const events = Array.from(eventsMap.values());

    // Sort by date
    events.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return upcoming ? dateA - dateB : dateB - dateA;
    });

    return events;
  } catch (error) {
    console.error("Error fetching events by discipline:", error);
    return [];
  }
}

function EventListSkeleton() {
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

async function UpcomingEventsSection({ discipline }: { discipline: Discipline }) {
  const events = await getEventsByDiscipline(discipline, true);

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No upcoming {getDisciplineLabel(discipline)} events found.
      </div>
    );
  }

  return <DisciplineEventList events={events} discipline={discipline} />;
}

async function RecentEventsSection({ discipline }: { discipline: Discipline }) {
  const events = await getEventsByDiscipline(discipline, false);

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No past {getDisciplineLabel(discipline)} events found.
      </div>
    );
  }

  return <DisciplineEventList events={events} discipline={discipline} />;
}

function DisciplineEventList({
  events,
  discipline,
}: {
  events: GroupedEvent[];
  discipline: Discipline;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {events.map((event) => (
        <EventCard
          key={event.id}
          id={event.id}
          name={event.name}
          date={event.date}
          endDate={event.endDate}
          country={event.country || undefined}
          discipline={event.discipline}
          subDiscipline={event.subDiscipline}
          slug={event.slug}
          categories={event.categories}
        />
      ))}
    </div>
  );
}

export default async function DisciplinePage({ params }: PageProps) {
  const { discipline } = await params;

  // Validate discipline
  if (!isValidDiscipline(discipline)) {
    notFound();
  }

  const disciplineLabel = getDisciplineLabel(discipline);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link
                href="/races"
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Races
              </Link>
              <span className="text-muted-foreground">/</span>
              <Badge variant="secondary">{disciplineLabel}</Badge>
            </div>
            <h1 className="text-3xl font-bold">{disciplineLabel} Events</h1>
            <p className="text-muted-foreground mt-1">
              Browse {disciplineLabel.toLowerCase()} cycling events and races
            </p>
          </div>
          <div className="flex gap-2">
            {discipline === "mtb" && <ImportHistoricalButton />}
            <Button asChild>
              <Link href="/races/new">+ Add Race</Link>
            </Button>
          </div>
        </div>

        <Tabs defaultValue="upcoming" className="space-y-6">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming">
            <Suspense fallback={<EventListSkeleton />}>
              <UpcomingEventsSection discipline={discipline} />
            </Suspense>
          </TabsContent>

          <TabsContent value="recent">
            <Suspense fallback={<EventListSkeleton />}>
              <RecentEventsSection discipline={discipline} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
