import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { CommunityIntel, RumourBadge } from "@/components/rumour-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  db,
  riders,
  riderDisciplineStats,
  teams,
  raceResults,
  races,
  riderRumours,
  userTips,
} from "@/lib/db";
import { eq, desc, and } from "drizzle-orm";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getRider(id: string) {
  try {
    const [rider] = await db
      .select()
      .from(riders)
      .where(eq(riders.id, id))
      .limit(1);
    return rider;
  } catch {
    return null;
  }
}

async function getRiderStats(riderId: string) {
  try {
    return await db
      .select({
        stats: riderDisciplineStats,
        team: teams,
      })
      .from(riderDisciplineStats)
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(eq(riderDisciplineStats.riderId, riderId));
  } catch {
    return [];
  }
}

async function getRiderResults(riderId: string) {
  try {
    return await db
      .select({
        result: raceResults,
        race: races,
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .where(eq(raceResults.riderId, riderId))
      .orderBy(desc(races.date))
      .limit(20);
  } catch {
    return [];
  }
}

async function getRiderRumours(riderId: string) {
  try {
    // Get aggregate rumour
    const [rumour] = await db
      .select()
      .from(riderRumours)
      .where(eq(riderRumours.riderId, riderId))
      .limit(1);

    // Get recent tips for this rider
    const tips = await db
      .select()
      .from(userTips)
      .where(
        and(
          eq(userTips.riderId, riderId),
          eq(userTips.processed, true)
        )
      )
      .orderBy(desc(userTips.createdAt))
      .limit(5);

    return { rumour, tips };
  } catch {
    return { rumour: null, tips: [] };
  }
}

function getEloTier(elo: number) {
  if (elo >= 1800) return { label: "Elite", color: "bg-purple-500" };
  if (elo >= 1650) return { label: "Pro", color: "bg-blue-500" };
  if (elo >= 1500) return { label: "Strong", color: "bg-green-500" };
  if (elo >= 1350) return { label: "Average", color: "bg-gray-400" };
  return { label: "Developing", color: "bg-gray-300" };
}

function getSpecialtyIcon(specialty: string) {
  const icons: Record<string, string> = {
    climber: "⛰️",
    sprinter: "⚡",
    gc: "🏆",
    tt: "⏱️",
    classics: "🏛️",
    puncheur: "💥",
    technical: "🔧",
    power: "💪",
  };
  return icons[specialty.toLowerCase()] || "🚴";
}

export default async function RiderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const rider = await getRider(id);

  if (!rider) {
    notFound();
  }

  const [statsData, resultsData, rumoursData] = await Promise.all([
    getRiderStats(id),
    getRiderResults(id),
    getRiderRumours(id),
  ]);

  const birthDate = rider.birthDate ? new Date(rider.birthDate) : null;
  const now = new Date();
  const age = birthDate
    ? Math.floor(
        (now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      )
    : null;

  const initials = rider.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Format tips as rumours for display
  const formattedRumours = rumoursData.tips.map((tip) => ({
    type: tip.tipType || "other",
    sentiment: parseFloat(tip.sentiment || "0"),
    summary: tip.tipText.slice(0, 100) + (tip.tipText.length > 100 ? "..." : ""),
    sourceCount: 1,
    daysAgo: Math.floor(
      (now.getTime() - new Date(tip.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    ),
  }));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-8">
        {/* Rider Header */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <Avatar className="h-24 w-24">
            <AvatarImage src={rider.photoUrl || undefined} alt={rider.name} />
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {rider.nationality && (
                <Badge variant="outline">{rider.nationality}</Badge>
              )}
              {rumoursData.rumour && (rumoursData.rumour.tipCount ?? 0) > 0 && (
                <RumourBadge
                  score={parseFloat(rumoursData.rumour.aggregateScore || "0")}
                  tipCount={rumoursData.rumour.tipCount ?? 0}
                  summary={rumoursData.rumour.summary || undefined}
                />
              )}
            </div>

            <h1 className="text-3xl font-bold">{rider.name}</h1>

            <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
              {age && <span>{age} years old</span>}
              {statsData.length > 0 && statsData[0].team && (
                <span>• {statsData[0].team.name}</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="stats" className="space-y-6">
              <TabsList>
                <TabsTrigger value="stats">Stats</TabsTrigger>
                <TabsTrigger value="results">Recent Results</TabsTrigger>
              </TabsList>

              <TabsContent value="stats" className="space-y-6">
                {statsData.length > 0 ? (
                  statsData.map(({ stats, team }) => {
                    const elo = parseFloat(stats.currentElo || "1500");
                    const tier = getEloTier(elo);
                    const affinities = (stats.profileAffinities as Record<string, number>) || {};

                    return (
                      <Card key={stats.id}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle>
                              {stats.discipline === "road"
                                ? "Road Cycling"
                                : stats.discipline === "mtb_xco"
                                  ? "MTB XCO"
                                  : stats.discipline === "mtb_xcc"
                                    ? "MTB XCC"
                                    : stats.discipline}
                            </CardTitle>
                            <Badge className={tier.color}>{tier.label}</Badge>
                          </div>
                          {team && (
                            <p className="text-sm text-muted-foreground">
                              {team.name}
                            </p>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {/* ELO Display */}
                          <div>
                            <div className="flex justify-between mb-2">
                              <span className="text-sm text-muted-foreground">
                                ELO Rating
                              </span>
                              <span className="text-2xl font-bold">
                                {Math.round(elo)}
                              </span>
                            </div>
                            <Progress
                              value={((elo - 1000) / 1000) * 100}
                              className="h-2"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>1000</span>
                              <span>2000</span>
                            </div>
                          </div>

                          {/* Career Stats */}
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <div className="text-2xl font-bold">
                                {stats.winsTotal || 0}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Wins
                              </div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold">
                                {stats.podiumsTotal || 0}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Podiums
                              </div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold">
                                {stats.racesTotal || 0}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Races
                              </div>
                            </div>
                          </div>

                          {/* Specialties */}
                          {stats.specialty && stats.specialty.length > 0 && (
                            <div>
                              <div className="text-sm text-muted-foreground mb-2">
                                Specialties
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {stats.specialty.map((s) => (
                                  <Badge key={s} variant="outline">
                                    {getSpecialtyIcon(s)} {s}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Profile Affinities */}
                          {Object.keys(affinities).length > 0 && (
                            <div>
                              <div className="text-sm text-muted-foreground mb-2">
                                Profile Affinities
                              </div>
                              <div className="space-y-2">
                                {Object.entries(affinities).map(
                                  ([profile, value]) => (
                                    <div key={profile}>
                                      <div className="flex justify-between text-sm mb-1">
                                        <span className="capitalize">
                                          {profile}
                                        </span>
                                        <span>
                                          {Math.round(value * 100)}%
                                        </span>
                                      </div>
                                      <Progress
                                        value={value * 100}
                                        className="h-1.5"
                                      />
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      No stats available yet for this rider.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="results">
                {resultsData.length > 0 ? (
                  <Card>
                    <CardContent className="py-4">
                      <div className="space-y-2">
                        {resultsData.map(({ result, race }) => (
                          <Link
                            key={result.id}
                            href={`/races/${race.id}`}
                            className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">{race.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {new Date(race.date).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {result.dnf ? (
                                <Badge variant="destructive">DNF</Badge>
                              ) : result.dns ? (
                                <Badge variant="outline">DNS</Badge>
                              ) : (
                                <Badge
                                  variant={
                                    result.position === 1
                                      ? "default"
                                      : result.position! <= 3
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {result.position}
                                  {result.position === 1 && " 🥇"}
                                  {result.position === 2 && " 🥈"}
                                  {result.position === 3 && " 🥉"}
                                </Badge>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      No recent results available.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Community Intel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Community Intel</CardTitle>
              </CardHeader>
              <CardContent>
                {formattedRumours.length > 0 ? (
                  <CommunityIntel rumours={formattedRumours} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No community intel available. Be the first to submit a tip!
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">External Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {rider.pcsId && (
                  <a
                    href={`https://www.procyclingstats.com/rider/${rider.pcsId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-primary hover:underline"
                  >
                    ProCyclingStats Profile →
                  </a>
                )}
                {rider.instagramHandle && (
                  <a
                    href={`https://instagram.com/${rider.instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-primary hover:underline"
                  >
                    Instagram →
                  </a>
                )}
                {rider.stravaId && (
                  <a
                    href={`https://www.strava.com/athletes/${rider.stravaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-primary hover:underline"
                  >
                    Strava →
                  </a>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
