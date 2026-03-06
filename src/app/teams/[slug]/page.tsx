import { notFound } from "next/navigation";
import Link from "next/link";
import { getFlag } from "@/lib/country-flags";
import { Header } from "@/components/header";
import { FollowButton } from "@/components/follow-button";
import { Badge } from "@/components/ui/badge";
import {
  db,
  teams,
  riders,
  riderDisciplineStats,
  raceResults,
  races,
  raceEvents,
  raceStartlist,
  predictions,
} from "@/lib/db";
import { eq, desc, and, gte, lte, inArray, asc } from "drizzle-orm";
import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from "date-fns";
import { buildEventUrl } from "@/lib/url-utils";

interface PageProps {
  params: Promise<{ slug: string }>;
}

function getEloTier(elo: number) {
  if (elo >= 1500) return { label: "Elite", color: "bg-purple-500" };
  if (elo >= 1200) return { label: "Pro", color: "bg-blue-500" };
  if (elo >= 900) return { label: "Strong", color: "bg-green-500" };
  if (elo >= 600) return { label: "Average", color: "bg-gray-400" };
  return { label: "Developing", color: "bg-gray-300" };
}

function raceProximityLabel(dateStr: string): { label: string; urgent: boolean } {
  const d = new Date(dateStr + "T12:00:00");
  if (isToday(d)) return { label: "Today", urgent: true };
  if (isTomorrow(d)) return { label: "Tomorrow", urgent: true };
  if (isPast(d)) return { label: format(d, "d MMM"), urgent: false };
  return { label: format(d, "d MMM"), urgent: false };
}

async function getTeamBySlug(slug: string) {
  try {
    const bySlug = await db.query.teams.findFirst({ where: eq(teams.slug, slug) });
    if (bySlug) return bySlug;
    const byId = await db.query.teams.findFirst({ where: eq(teams.id, slug) });
    return byId ?? null;
  } catch { return null; }
}

async function getTeamRiders(teamId: string) {
  try {
    const rows = await db
      .select({
        rider: riders,
        elo: riderDisciplineStats.currentElo,
        winsTotal: riderDisciplineStats.winsTotal,
        podiumsTotal: riderDisciplineStats.podiumsTotal,
        racesTotal: riderDisciplineStats.racesTotal,
        uciPoints: riderDisciplineStats.uciPoints,
        uciRank: riderDisciplineStats.uciRank,
      })
      .from(riders)
      .leftJoin(riderDisciplineStats, eq(riderDisciplineStats.riderId, riders.id))
      .where(eq(riders.teamId, teamId))
      .orderBy(riders.name);

    const map = new Map<string, {
      rider: typeof rows[0]["rider"];
      bestElo: number;
      totalWins: number;
      totalPodiums: number;
      totalRaces: number;
      bestUciPoints: number;
      bestUciRank: number | null;
    }>();

    for (const row of rows) {
      const elo = parseFloat(row.elo || "0");
      const existing = map.get(row.rider.id);
      if (!existing) {
        map.set(row.rider.id, {
          rider: row.rider,
          bestElo: elo,
          totalWins: row.winsTotal || 0,
          totalPodiums: row.podiumsTotal || 0,
          totalRaces: row.racesTotal || 0,
          bestUciPoints: row.uciPoints || 0,
          bestUciRank: row.uciRank ?? null,
        });
      } else {
        if (elo > existing.bestElo) existing.bestElo = elo;
        existing.totalWins += row.winsTotal || 0;
        existing.totalPodiums += row.podiumsTotal || 0;
        existing.totalRaces += row.racesTotal || 0;
        if ((row.uciPoints || 0) > existing.bestUciPoints) existing.bestUciPoints = row.uciPoints || 0;
        if (row.uciRank && (!existing.bestUciRank || row.uciRank < existing.bestUciRank)) existing.bestUciRank = row.uciRank;
      }
    }

    return [...map.values()].sort((a, b) => b.bestElo - a.bestElo);
  } catch { return []; }
}

async function getTeamResults(teamId: string) {
  try {
    return await db
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
      .limit(15);
  } catch { return []; }
}

interface UpcomingRaceEntry {
  eventId: string;
  eventName: string;
  eventSlug: string | null;
  discipline: string;
  date: string;
  endDate: string | null;
  uciCategory: string | null;
  riders: Array<{
    riderId: string;
    riderName: string;
    nationality: string | null;
    photoUrl: string | null;
    raceId: string;
    gender: string;
    categorySlug: string | null;
    predictedPosition: number | null;
    winProbability: number | null;
  }>;
}

async function getUpcomingRaces(teamId: string): Promise<UpcomingRaceEntry[]> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

    // Get all rider IDs on this team
    const teamRiders = await db
      .select({ id: riders.id, name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
      .from(riders)
      .where(eq(riders.teamId, teamId));

    if (teamRiders.length === 0) return [];
    const riderIds = teamRiders.map(r => r.id);

    // Find startlist entries for these riders in upcoming races
    const startlistRows = await db
      .select({
        sl: raceStartlist,
        race: races,
        event: raceEvents,
      })
      .from(raceStartlist)
      .innerJoin(races, eq(raceStartlist.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(
        and(
          inArray(raceStartlist.riderId, riderIds),
          gte(raceEvents.date, today),
          lte(raceEvents.date, twoWeeks),
          eq(races.status, "active")
        )
      )
      .orderBy(asc(raceEvents.date));

    if (startlistRows.length === 0) return [];

    // Collect race IDs for prediction lookup
    const raceIdSet = new Set(startlistRows.map(r => r.race.id));
    const predRows = await db
      .select({
        raceId: predictions.raceId,
        riderId: predictions.riderId,
        predictedPosition: predictions.predictedPosition,
        winProbability: predictions.winProbability,
      })
      .from(predictions)
      .where(inArray(predictions.raceId, [...raceIdSet]));

    const predMap = new Map<string, { predictedPosition: number | null; winProbability: number | null }>();
    for (const p of predRows) {
      predMap.set(`${p.raceId}:${p.riderId}`, {
        predictedPosition: p.predictedPosition,
        winProbability: p.winProbability ? parseFloat(p.winProbability) : null,
      });
    }

    const riderMap = new Map(teamRiders.map(r => [r.id, r]));

    // Group by event
    const eventMap = new Map<string, UpcomingRaceEntry>();
    for (const { sl, race, event } of startlistRows) {
      const rider = riderMap.get(sl.riderId);
      if (!rider) continue;

      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, {
          eventId: event.id,
          eventName: event.name,
          eventSlug: event.slug,
          discipline: event.discipline,
          date: event.date,
          endDate: event.endDate ?? null,
          uciCategory: race.uciCategory ?? null,
          riders: [],
        });
      }

      const pred = predMap.get(`${race.id}:${sl.riderId}`);
      eventMap.get(event.id)!.riders.push({
        riderId: rider.id,
        riderName: rider.name,
        nationality: rider.nationality ?? null,
        photoUrl: rider.photoUrl ?? null,
        raceId: race.id,
        gender: race.gender ?? "men",
        categorySlug: race.categorySlug ?? null,
        predictedPosition: pred?.predictedPosition ?? null,
        winProbability: pred?.winProbability ?? null,
      });
    }

    // Sort riders within each event by predicted position (nulls last), then name
    for (const entry of eventMap.values()) {
      entry.riders.sort((a, b) => {
        if (a.predictedPosition !== null && b.predictedPosition !== null)
          return a.predictedPosition - b.predictedPosition;
        if (a.predictedPosition !== null) return -1;
        if (b.predictedPosition !== null) return 1;
        return a.riderName.localeCompare(b.riderName);
      });
      // Deduplicate same rider across multiple stages/categories
      const seen = new Set<string>();
      entry.riders = entry.riders.filter(r => {
        if (seen.has(r.riderId)) return false;
        seen.add(r.riderId);
        return true;
      });
    }

    return [...eventMap.values()].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  } catch (e) {
    console.error("getUpcomingRaces error:", e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function TeamProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();

  const [rosterRiders, recentResults, upcomingRaces] = await Promise.all([
    getTeamRiders(team.id),
    getTeamResults(team.id),
    getUpcomingRaces(team.id),
  ]);

  const teamTotalWins = rosterRiders.reduce((s, r) => s + r.totalWins, 0);
  const teamTotalPodiums = rosterRiders.reduce((s, r) => s + r.totalPodiums, 0);
  const teamBestElo = rosterRiders.length > 0 ? Math.max(...rosterRiders.map(r => r.bestElo)) : 0;

  const initials = team.name.split(/[\s-]+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">
            <nav className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground">
              <Link href="/teams" className="hover:text-foreground transition-colors">Teams</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{team.name}</span>
            </nav>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="shrink-0">
                {team.logoUrl ? (
                  <div className="w-28 h-28 rounded-2xl overflow-hidden border border-border/50 bg-muted flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={team.logoUrl} alt={team.name} className="w-full h-full object-contain p-2" />
                  </div>
                ) : (
                  <div className="w-28 h-28 rounded-2xl flex items-center justify-center text-2xl font-black text-white bg-gradient-to-br from-primary/80 to-primary/40 border border-border/50">
                    {initials}
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {team.division && <Badge className="bg-blue-500 text-white text-xs">{team.division}</Badge>}
                  {team.discipline && (
                    <Badge variant="outline" className="text-xs capitalize">
                      {team.discipline === "mtb" ? "MTB" : team.discipline}
                    </Badge>
                  )}
                  {team.uciCode && <Badge variant="outline" className="text-xs font-mono">{team.uciCode}</Badge>}
                </div>

                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">
                    {team.country && <span className="mr-2">{getFlag(team.country)}</span>}
                    {team.name}
                  </h1>
                  <FollowButton entityId={team.id} followType="team" entityName={team.name} />
                </div>

                {(team.website || team.twitter || team.instagram) && (
                  <div className="flex items-center gap-3 text-xs pt-1">
                    {team.website && (
                      <a href={team.website} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                        🌐 Website
                      </a>
                    )}
                    {team.twitter && (
                      <a href={team.twitter} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                        𝕏 Twitter
                      </a>
                    )}
                    {team.instagram && (
                      <a href={team.instagram} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                        📸 Instagram
                      </a>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-4 pt-2">
                  <div className="text-center">
                    <div className="text-xl font-black">{rosterRiders.length}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Riders</div>
                  </div>
                  {teamTotalWins > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{teamTotalWins}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Wins</div>
                    </div>
                  )}
                  {teamTotalPodiums > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{teamTotalPodiums}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Podiums</div>
                    </div>
                  )}
                  {upcomingRaces.length > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{upcomingRaces.length}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Upcoming</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── UPCOMING RACES ────────────────────────────────────────────── */}
        {upcomingRaces.length > 0 && (
          <section className="border-b border-border/50 bg-muted/20">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-base font-bold mb-4">
                Upcoming Races
                <span className="ml-2 text-xs font-normal text-muted-foreground">next 2 weeks</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingRaces.map((entry) => {
                  const { label, urgent } = raceProximityLabel(entry.date);
                  const eventUrl = entry.eventSlug
                    ? buildEventUrl(entry.discipline, entry.eventSlug)
                    : null;
                  const topPredicted = entry.riders.find(r => r.predictedPosition !== null && r.winProbability !== null);

                  return (
                    <div key={entry.eventId} className="rounded-xl border border-border/50 bg-background p-4 space-y-3">
                      {/* Race header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {eventUrl ? (
                            <Link href={eventUrl} className="font-semibold text-sm hover:text-primary transition-colors line-clamp-2">
                              {entry.eventName}
                            </Link>
                          ) : (
                            <p className="font-semibold text-sm line-clamp-2">{entry.eventName}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            {entry.uciCategory && (
                              <span className="text-[10px] text-muted-foreground font-mono">{entry.uciCategory}</span>
                            )}
                          </div>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                          urgent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}>
                          {label}
                        </span>
                      </div>

                      {/* Top predicted rider callout */}
                      {topPredicted && (
                        <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
                          {topPredicted.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={topPredicted.photoUrl} alt={topPredicted.riderName}
                              className="w-7 h-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {topPredicted.riderName.charAt(0)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <Link href={`/riders/${topPredicted.riderId}`}
                              className="text-sm font-semibold truncate block hover:text-primary transition-colors">
                              {topPredicted.riderName}
                            </Link>
                            <p className="text-[10px] text-muted-foreground">Best predicted rider</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-black text-primary">
                              {(topPredicted.winProbability! * 100).toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-muted-foreground">win chance</p>
                          </div>
                        </div>
                      )}

                      {/* Rider list */}
                      <div className="space-y-1.5">
                        {entry.riders.slice(0, 6).map((rider) => (
                          <div key={rider.riderId} className="flex items-center gap-2 text-sm">
                            <span className="text-xs w-4 shrink-0 text-center text-muted-foreground">
                              {rider.nationality ? getFlag(rider.nationality) : ""}
                            </span>
                            <Link href={`/riders/${rider.riderId}`}
                              className="flex-1 truncate font-medium hover:text-primary transition-colors text-xs">
                              {rider.riderName}
                            </Link>
                            {rider.predictedPosition !== null ? (
                              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                                P{rider.predictedPosition}
                                {rider.winProbability !== null && rider.winProbability > 0.02
                                  ? ` · ${(rider.winProbability * 100).toFixed(0)}%`
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/50 shrink-0">entered</span>
                            )}
                          </div>
                        ))}
                        {entry.riders.length > 6 && (
                          <p className="text-[10px] text-muted-foreground pt-0.5">
                            +{entry.riders.length - 6} more riders
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── ROSTER + RESULTS ─────────────────────────────────────────── */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
          <div className="grid gap-8 lg:grid-cols-3">

            {/* Current Roster (2 cols) */}
            <div className="lg:col-span-2">
              <h2 className="text-base font-bold mb-3">Current Roster ({rosterRiders.length})</h2>
              {rosterRiders.length > 0 ? (
                <div className="rounded-xl border border-border/50 divide-y divide-border/30">
                  {rosterRiders.map(({ rider, bestElo, bestUciRank }) => {
                    const birthDate = rider.birthDate ? new Date(rider.birthDate) : null;
                    const age = birthDate
                      ? Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                      : null;
                    const tier = bestElo > 0 ? getEloTier(bestElo) : null;
                    const isEntered = upcomingRaces.some(r => r.riders.some(ri => ri.riderId === rider.id));

                    return (
                      <Link key={rider.id} href={`/riders/${rider.id}`}
                        className="flex items-center gap-3 py-2.5 px-3 hover:bg-muted/50 transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-muted/50 shrink-0">
                          {rider.nationality ? getFlag(rider.nationality) : rider.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{rider.name}</p>
                            {isEntered && (
                              <span className="text-[9px] font-bold bg-primary/20 text-primary px-1 py-0 rounded shrink-0">
                                RACING
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {rider.nationality && <span>{rider.nationality}</span>}
                            {age && <span>· {age}y</span>}
                            {bestUciRank && <span>· UCI #{bestUciRank}</span>}
                          </div>
                        </div>
                        {tier && (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground font-mono">{Math.round(bestElo)}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${tier.color}`}>
                              {tier.label}
                            </span>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
                  No riders on this team yet
                </div>
              )}
            </div>

            {/* Recent Results (1 col sidebar) */}
            <div>
              <h2 className="text-base font-bold mb-3">Recent Results</h2>
              {recentResults.length > 0 ? (
                <div className="rounded-xl border border-border/50 divide-y divide-border/30">
                  {recentResults.map(({ result, rider, race, event }) => (
                    <div key={result.id} className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 shrink-0 text-center">
                          {result.dnf ? (
                            <span className="text-xs font-bold text-red-400">DNF</span>
                          ) : result.dns ? (
                            <span className="text-xs font-bold text-muted-foreground">DNS</span>
                          ) : (
                            <span className={`text-sm font-black ${result.position === 1 ? "text-yellow-400" : result.position! <= 3 ? "text-orange-400" : ""}`}>
                              {result.position === 1 ? "🥇" : result.position === 2 ? "🥈" : result.position === 3 ? "🥉" : `P${result.position}`}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <Link href={`/riders/${rider.id}`}
                            className="text-sm font-medium truncate block hover:text-primary transition-colors">
                            {rider.name}
                          </Link>
                          <p className="text-xs text-muted-foreground truncate">
                            {event?.name || race.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60">
                            {format(new Date(race.date + "T12:00:00"), "d MMM yyyy")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
                  No recorded results yet
                </div>
              )}
            </div>

          </div>
        </div>

      </main>
    </div>
  );
}
