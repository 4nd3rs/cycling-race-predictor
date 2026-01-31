import { Suspense } from "react";
import { Header } from "@/components/header";
import { RaceList } from "@/components/race-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, races } from "@/lib/db";
import { desc, eq, gte, lt, and } from "drizzle-orm";
import Link from "next/link";

async function getUpcomingRaces() {
  const today = new Date().toISOString().split("T")[0];

  try {
    return await db
      .select()
      .from(races)
      .where(
        and(
          gte(races.date, today),
          eq(races.status, "active")
        )
      )
      .orderBy(races.date)
      .limit(50);
  } catch {
    return [];
  }
}

async function getRecentRaces() {
  const today = new Date().toISOString().split("T")[0];

  try {
    return await db
      .select()
      .from(races)
      .where(lt(races.date, today))
      .orderBy(desc(races.date))
      .limit(50);
  } catch {
    return [];
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
  const upcomingRaces = await getUpcomingRaces();

  const formattedRaces = upcomingRaces.map((race) => ({
    id: race.id,
    name: race.name,
    date: race.date,
    country: race.country || undefined,
    discipline: race.discipline,
    profileType: race.profileType || undefined,
    uciCategory: race.uciCategory || undefined,
    status: race.status || "active",
  }));

  return (
    <RaceList
      races={formattedRaces}
      emptyMessage="No upcoming races found. Add a race to get started!"
    />
  );
}

async function RecentRacesSection() {
  const recentRaces = await getRecentRaces();

  const formattedRaces = recentRaces.map((race) => ({
    id: race.id,
    name: race.name,
    date: race.date,
    country: race.country || undefined,
    discipline: race.discipline,
    profileType: race.profileType || undefined,
    uciCategory: race.uciCategory || undefined,
    status: race.status || "completed",
  }));

  return (
    <RaceList
      races={formattedRaces}
      emptyMessage="No past races found."
    />
  );
}

export default function RacesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Races</h1>
            <p className="text-muted-foreground mt-1">
              Browse upcoming races and view predictions
            </p>
          </div>
          <Button asChild>
            <Link href="/races/new">+ Add Race</Link>
          </Button>
        </div>

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
      </main>
    </div>
  );
}
