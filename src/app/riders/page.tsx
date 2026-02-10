import { Suspense } from "react";
import { Header } from "@/components/header";
import { RiderList } from "@/components/rider-card";
import { Input } from "@/components/ui/input";
import { db, riders, riderDisciplineStats, teams } from "@/lib/db";
import { desc, eq, ilike } from "drizzle-orm";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

async function getRiders(query?: string) {
  try {
    const results = await db
      .select({
        rider: riders,
        stats: riderDisciplineStats,
        team: teams,
      })
      .from(riders)
      .leftJoin(
        riderDisciplineStats,
        eq(riders.id, riderDisciplineStats.riderId)
      )
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(query ? ilike(riders.name, `%${query}%`) : undefined)
      .orderBy(desc(riderDisciplineStats.currentElo))
      .limit(100);

    // Group results by rider
    const riderMap = new Map<
      string,
      {
        rider: typeof riders.$inferSelect;
        stats: Array<typeof riderDisciplineStats.$inferSelect>;
        team: (typeof teams.$inferSelect) | null;
      }
    >();

    for (const row of results) {
      if (!riderMap.has(row.rider.id)) {
        riderMap.set(row.rider.id, {
          rider: row.rider,
          stats: [],
          team: row.team,
        });
      }
      if (row.stats) {
        riderMap.get(row.rider.id)!.stats.push(row.stats);
      }
    }

    return Array.from(riderMap.values());
  } catch {
    return [];
  }
}

function RiderListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(9)].map((_, i) => (
        <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

async function RidersSection({ query }: { query?: string }) {
  const riderData = await getRiders(query);
  const now = new Date();

  const formattedRiders = riderData.map(({ rider, stats, team }) => {
    const birthDate = rider.birthDate ? new Date(rider.birthDate) : null;
    const age = birthDate
      ? Math.floor(
          (now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
        )
      : undefined;

    return {
      id: rider.id,
      name: rider.name,
      nationality: rider.nationality || undefined,
      photoUrl: rider.photoUrl || undefined,
      team: team?.name || undefined,
      age,
      stats: stats.map((s) => ({
        discipline: s.discipline,
        currentElo: parseFloat(s.currentElo || "1500"),
        winsTotal: s.winsTotal || 0,
        podiumsTotal: s.podiumsTotal || 0,
        racesTotal: s.racesTotal || 0,
        specialty: s.specialty || undefined,
      })),
    };
  });

  return <RiderList riders={formattedRiders} />;
}

export default async function RidersPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Riders</h1>
            <p className="text-muted-foreground mt-1">
              Browse professional cyclists and their ELO ratings
            </p>
          </div>
        </div>

        <form className="mb-8 max-w-md">
          <Input
            type="search"
            name="q"
            placeholder="Search riders..."
            defaultValue={q}
          />
        </form>

        <Suspense fallback={<RiderListSkeleton />}>
          <RidersSection query={q} />
        </Suspense>
      </main>
    </div>
  );
}
