import { notFound } from "next/navigation";
import Link from "next/link";
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
} from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";

interface PageProps {
  params: Promise<{ slug: string }>;
}

function countryToFlag(code?: string | null) {
  if (!code) return "";
  const c = code.toUpperCase();
  const map: Record<string, string> = {
    GER: "DE", USA: "US", RSA: "ZA", GBR: "GB", NED: "NL", DEN: "DK",
    SUI: "CH", AUT: "AT", BEL: "BE", FRA: "FR", ITA: "IT", ESP: "ES",
    POR: "PT", NOR: "NO", SWE: "SE", FIN: "FI", POL: "PL", CZE: "CZ",
    AUS: "AU", NZL: "NZ", JPN: "JP", COL: "CO", ECU: "EC", SLO: "SI",
    CRO: "HR", UKR: "UA", KAZ: "KZ", ERI: "ER", ETH: "ET", RWA: "RW",
  };
  const a2 = c.length === 2 ? c : (map[c] || c.slice(0, 2));
  return String.fromCodePoint(...[...a2].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function getEloTier(elo: number) {
  if (elo >= 1500) return { label: "Elite", color: "bg-purple-500" };
  if (elo >= 1200) return { label: "Pro", color: "bg-blue-500" };
  if (elo >= 900) return { label: "Strong", color: "bg-green-500" };
  if (elo >= 600) return { label: "Average", color: "bg-gray-400" };
  return { label: "Developing", color: "bg-gray-300" };
}

async function getTeamBySlug(slug: string) {
  try {
    // Try slug first
    const bySlug = await db.query.teams.findFirst({
      where: eq(teams.slug, slug),
    });
    if (bySlug) return bySlug;
    // Fallback to UUID for backward compat
    const byId = await db.query.teams.findFirst({
      where: eq(teams.id, slug),
    });
    return byId ?? null;
  } catch {
    return null;
  }
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

    // Deduplicate: one entry per rider, keep best ELO, sum stats
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
  } catch {
    return [];
  }
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
      .limit(10);
  } catch {
    return [];
  }
}

export default async function TeamProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);

  if (!team) {
    notFound();
  }

  const [rosterRiders, recentResults] = await Promise.all([
    getTeamRiders(team.id),
    getTeamResults(team.id),
  ]);

  // Aggregate team-level stats
  const teamTotalWins = rosterRiders.reduce((s, r) => s + r.totalWins, 0);
  const teamTotalPodiums = rosterRiders.reduce((s, r) => s + r.totalPodiums, 0);
  const teamBestElo = rosterRiders.length > 0 ? Math.max(...rosterRiders.map(r => r.bestElo)) : 0;

  const initials = team.name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground">
              <Link href="/teams" className="hover:text-foreground transition-colors">Teams</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{team.name}</span>
            </nav>

            <div className="flex flex-col sm:flex-row gap-6 items-start">

              {/* Logo / Initials */}
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

              {/* Identity */}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {team.division && (
                    <Badge className="bg-blue-500 text-white text-xs">{team.division}</Badge>
                  )}
                  {team.discipline && (
                    <Badge variant="outline" className="text-xs capitalize">
                      {team.discipline === "mtb" ? "MTB" : team.discipline}
                    </Badge>
                  )}
                  {team.uciCode && (
                    <Badge variant="outline" className="text-xs font-mono">{team.uciCode}</Badge>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">
                    {team.country && <span className="mr-2">{countryToFlag(team.country)}</span>}
                    {team.name}
                  </h1>
                  <FollowButton entityId={team.id} followType="team" entityName={team.name} />
                </div>

                {/* Social links */}
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

                {/* Key stats strip */}
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
                  {teamBestElo > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{Math.round(teamBestElo)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Top ELO</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ROSTER + RESULTS ─────────────────────────────────────────── */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
          <div className="grid gap-8 lg:grid-cols-3">

            {/* Current Roster (2 cols) */}
            <div className="lg:col-span-2">
              <h2 className="text-base font-bold mb-3">🚴 Current Roster ({rosterRiders.length})</h2>
              {rosterRiders.length > 0 ? (
                <div className="rounded-xl border border-border/50 divide-y divide-border/30">
                  {rosterRiders.map(({ rider, bestElo, bestUciRank }) => {
                    const birthDate = rider.birthDate ? new Date(rider.birthDate) : null;
                    const age = birthDate
                      ? Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                      : null;
                    const tier = bestElo > 0 ? getEloTier(bestElo) : null;

                    return (
                      <Link key={rider.id} href={`/riders/${rider.id}`}
                        className="flex items-center gap-3 py-2.5 px-3 hover:bg-muted/50 transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-muted/50 shrink-0">
                          {rider.nationality ? countryToFlag(rider.nationality) : rider.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{rider.name}</p>
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
              <h2 className="text-base font-bold mb-3">🏁 Recent Results</h2>
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
