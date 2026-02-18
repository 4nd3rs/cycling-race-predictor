import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, teams, riders, raceResults, races, raceEvents } from "@/lib/db";
import { eq, desc, sql } from "drizzle-orm";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getTeam(id: string) {
  try {
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, id),
    });
    return team;
  } catch (error) {
    console.error("Error fetching team:", error);
    return null;
  }
}

async function getTeamRiders(teamId: string) {
  try {
    const riderList = await db
      .select({
        rider: riders,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.rider_id = ${riders.id})`,
      })
      .from(riders)
      .where(eq(riders.teamId, teamId))
      .orderBy(riders.name);

    return riderList;
  } catch (error) {
    console.error("Error fetching team riders:", error);
    return [];
  }
}

async function getTeamResults(teamId: string) {
  try {
    const results = await db
      .select({
        result: raceResults,
        rider: riders,
        race: races,
        event: raceEvents,
      })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(eq(raceResults.teamId, teamId))
      .orderBy(desc(races.date))
      .limit(20);

    return results;
  } catch (error) {
    console.error("Error fetching team results:", error);
    return [];
  }
}

export default async function TeamPage({ params }: PageProps) {
  const { id } = await params;

  const team = await getTeam(id);
  if (!team) {
    notFound();
  }

  const [riderList, recentResults] = await Promise.all([
    getTeamRiders(id),
    getTeamResults(id),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <Link
            href="/teams"
            className="text-muted-foreground hover:text-foreground"
          >
            Teams
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{team.name}</span>
        </div>

        {/* Team Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {team.discipline && (
              <Badge variant="secondary">
                {team.discipline === "mtb" ? "MTB" : team.discipline}
              </Badge>
            )}
            {team.country && <Badge variant="outline">{team.country}</Badge>}
            {team.division && <Badge variant="outline">{team.division}</Badge>}
          </div>
          <h1 className="text-3xl font-bold mb-2">{team.name}</h1>
          {team.uciCode && (
            <p className="text-muted-foreground">UCI Code: {team.uciCode}</p>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Riders Section */}
          <div>
            <h2 className="text-xl font-semibold mb-4">
              Riders ({riderList.length})
            </h2>
            {riderList.length > 0 ? (
              <div className="space-y-2">
                {riderList.map(({ rider, resultCount }) => (
                  <Link key={rider.id} href={`/riders/${rider.id}`}>
                    <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                      <CardContent className="py-3 flex items-center justify-between">
                        <span className="font-medium">{rider.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {Number(resultCount)} results
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No riders found.</p>
            )}
          </div>

          {/* Recent Results Section */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Recent Results</h2>
            {recentResults.length > 0 ? (
              <div className="space-y-2">
                {recentResults.map(({ result, rider, race, event }) => (
                  <Card key={result.id}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            {result.position ? `#${result.position}` : "-"}{" "}
                            <Link
                              href={`/riders/${rider.id}`}
                              className="hover:underline"
                            >
                              {rider.name}
                            </Link>
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {event?.name || race.name}
                          </p>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {race.date}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No recent results.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
