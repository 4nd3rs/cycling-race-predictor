import { Suspense } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db, teams, riders } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";

async function getTeams() {
  try {
    const teamList = await db
      .select({
        team: teams,
        riderCount: sql<number>`(SELECT COUNT(*) FROM riders WHERE riders.team_id = ${teams.id})`,
      })
      .from(teams)
      .orderBy(teams.name)
      .limit(200);

    return teamList;
  } catch (error) {
    console.error("Error fetching teams:", error);
    return [];
  }
}

function TeamsListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(9)].map((_, i) => (
        <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

async function TeamsList() {
  const teamList = await getTeams();

  if (teamList.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No teams found.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {teamList.map(({ team, riderCount }) => (
        <Link key={team.id} href={`/teams/${team.id}`}>
          <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{team.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {team.discipline && (
                  <Badge variant="secondary">
                    {team.discipline === "mtb" ? "MTB" : team.discipline}
                  </Badge>
                )}
                {team.country && (
                  <Badge variant="outline">{team.country}</Badge>
                )}
                <span className="text-sm text-muted-foreground ml-auto">
                  {Number(riderCount)} rider{Number(riderCount) !== 1 ? "s" : ""}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function TeamsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="text-muted-foreground mt-1">
            Browse cycling teams and their riders
          </p>
        </div>

        <Suspense fallback={<TeamsListSkeleton />}>
          <TeamsList />
        </Suspense>
      </main>
    </div>
  );
}
