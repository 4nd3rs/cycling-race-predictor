import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { PredictionList } from "@/components/prediction-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, races, predictions, riders, raceStartlist } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getRace(id: string) {
  try {
    const [race] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);
    return race;
  } catch {
    return null;
  }
}

async function getRacePredictions(raceId: string) {
  try {
    const results = await db
      .select({
        prediction: predictions,
        rider: riders,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .where(eq(predictions.raceId, raceId))
      .orderBy(desc(predictions.winProbability))
      .limit(50);

    return results;
  } catch {
    return [];
  }
}

async function getRaceStartlist(raceId: string) {
  try {
    const results = await db
      .select({
        entry: raceStartlist,
        rider: riders,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .where(eq(raceStartlist.raceId, raceId))
      .orderBy(raceStartlist.bibNumber);

    return results;
  } catch {
    return [];
  }
}

function getProfileIcon(profile?: string | null) {
  const icons: Record<string, string> = {
    flat: "➖",
    hilly: "〰️",
    mountain: "⛰️",
    tt: "⏱️",
    cobbles: "🪨",
  };
  return profile ? icons[profile] || "🚴" : "🚴";
}

export default async function RaceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const race = await getRace(id);

  if (!race) {
    notFound();
  }

  const [racePredictions, startlist] = await Promise.all([
    getRacePredictions(id),
    getRaceStartlist(id),
  ]);

  const formattedPredictions = racePredictions.map(({ prediction, rider }) => ({
    riderId: rider.id,
    riderName: rider.name,
    nationality: rider.nationality || undefined,
    predictedPosition: prediction.predictedPosition || 0,
    winProbability: parseFloat(prediction.winProbability || "0"),
    podiumProbability: parseFloat(prediction.podiumProbability || "0"),
    top10Probability: parseFloat(prediction.top10Probability || "0"),
    reasoning: prediction.reasoning || undefined,
  }));

  const raceDate = new Date(race.date);
  const isUpcoming = raceDate > new Date();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-8">
        {/* Race Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant={race.discipline === "road" ? "default" : "secondary"}>
              {race.discipline === "road" ? "Road" : race.discipline.toUpperCase()}
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

          <h1 className="text-3xl font-bold">{race.name}</h1>

          <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
            <span>{format(raceDate, "EEEE, MMMM d, yyyy")}</span>
            {race.country && <span>• {race.country}</span>}
            {race.distanceKm && (
              <span>• {parseFloat(race.distanceKm).toFixed(1)} km</span>
            )}
            {race.elevationM && <span>• {race.elevationM}m elevation</span>}
          </div>
        </div>

        <Tabs defaultValue="predictions" className="space-y-6">
          <TabsList>
            <TabsTrigger value="predictions">
              Predictions ({formattedPredictions.length})
            </TabsTrigger>
            <TabsTrigger value="startlist">
              Startlist ({startlist.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="predictions">
            {formattedPredictions.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <PredictionList predictions={formattedPredictions} maxItems={20} />
                </div>
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Race Favorites</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {formattedPredictions.slice(0, 5).map((pred, i) => (
                          <div
                            key={pred.riderId}
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-4">
                                {i + 1}.
                              </span>
                              <span className="font-medium truncate">
                                {pred.riderName}
                              </span>
                            </div>
                            <span className="text-sm font-bold">
                              {(pred.winProbability * 100).toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Prediction Info</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-2">
                      <p>
                        Predictions are generated using TrueSkill ELO ratings,
                        recent form analysis, and race profile matching.
                      </p>
                      <p>
                        Community intel can modify predictions by up to 5%.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    No predictions available yet. Predictions will be generated
                    once the startlist is confirmed.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="startlist">
            {startlist.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {startlist.map(({ entry, rider }) => (
                  <Card key={entry.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        {entry.bibNumber && (
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold">
                            {entry.bibNumber}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium truncate">{rider.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {rider.nationality || ""}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    Startlist not yet available.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
