import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { CommunityIntel, RumourBadge } from "@/components/rumour-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FollowButton } from "@/components/follow-button";
import {
  db,
  riders,
  riderDisciplineStats,
  teams,
  raceResults,
  races,
  raceEvents,
  raceStartlist,
  riderRumours,
  userTips,
} from "@/lib/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { format, formatDistanceToNow } from "date-fns";

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

async function getRiderUpcomingRaces(riderId: string) {
  try {
    const today = new Date().toISOString().substring(0, 10);
    return await db
      .select({ race: races, event: raceEvents })
      .from(raceStartlist)
      .innerJoin(races, eq(raceStartlist.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(eq(raceStartlist.riderId, riderId), gte(races.date, today)))
      .orderBy(races.date)
      .limit(5);
  } catch { return []; }
}

function countryToFlag(code?: string | null) {
  if (!code) return "";
  const c = code.toUpperCase();
  const map: Record<string, string> = {
    GER:"DE", USA:"US", RSA:"ZA", GBR:"GB", NED:"NL", DEN:"DK",
    SUI:"CH", AUT:"AT", BEL:"BE", FRA:"FR", ITA:"IT", ESP:"ES",
    POR:"PT", NOR:"NO", SWE:"SE", FIN:"FI", POL:"PL", CZE:"CZ",
    AUS:"AU", NZL:"NZ", JPN:"JP", COL:"CO", ECU:"EC", SLO:"SI",
    CRO:"HR", UKR:"UA", KAZ:"KZ", ERI:"ER", ETH:"ET", RWA:"RW",
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

  const [rawStatsData, resultsData, rumoursData, upcomingRaces] = await Promise.all([
    getRiderStats(id),
    getRiderResults(id),
    getRiderRumours(id),
    getRiderUpcomingRaces(id),
  ]);

  // Merge duplicate MTB stats (mtb + mtb_xco) — combine ELO/race data with rankings
  const statsData = (() => {
    const mtbEntries = rawStatsData.filter(({ stats }) => stats.discipline.startsWith("mtb"));
    const otherEntries = rawStatsData.filter(({ stats }) => !stats.discipline.startsWith("mtb"));
    if (mtbEntries.length <= 1) return rawStatsData;

    // Group by ageCategory, merge all MTB entries into one
    const byCategory = new Map<string, (typeof mtbEntries)[0]>();
    for (const entry of mtbEntries) {
      const key = entry.stats.ageCategory;
      const existing = byCategory.get(key);
      if (!existing) {
        byCategory.set(key, { ...entry, stats: { ...entry.stats, discipline: "mtb" } });
      } else {
        // Merge: take ELO/race stats from the entry with actual races,
        // and rankings from the entry with ranking data
        const merged = { ...existing.stats };
        const s = entry.stats;
        // Use the entry with more races for ELO data
        if ((s.racesTotal ?? 0) > (merged.racesTotal ?? 0)) {
          merged.currentElo = s.currentElo;
          merged.eloMean = s.eloMean;
          merged.eloVariance = s.eloVariance;
          merged.racesTotal = s.racesTotal;
          merged.winsTotal = s.winsTotal;
          merged.podiumsTotal = s.podiumsTotal;
        }
        // Take highest ranking data from either entry
        if ((s.uciPoints ?? 0) > (merged.uciPoints ?? 0)) {
          merged.uciPoints = s.uciPoints;
          merged.uciRank = s.uciRank;
        }
        if ((s.supercupPoints ?? 0) > (merged.supercupPoints ?? 0)) {
          merged.supercupPoints = s.supercupPoints;
          merged.supercupRank = s.supercupRank;
        }
        if ((s.worldCupPoints ?? 0) > (merged.worldCupPoints ?? 0)) {
          merged.worldCupPoints = s.worldCupPoints;
          merged.worldCupRank = s.worldCupRank;
        }
        // Use team from either if available
        const team = entry.team || existing.team;
        byCategory.set(key, { stats: { ...merged, discipline: "mtb" }, team });
      }
    }
    return [...otherEntries, ...byCategory.values()];
  })();

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


  // Aggregate best stats across disciplines
  const bestElo = Math.max(...statsData.map(s => parseFloat(s.stats.currentElo || "0")), 0);
  const totalWins = statsData.reduce((sum, s) => sum + (s.stats.winsTotal || 0), 0);
  const totalPodiums = statsData.reduce((sum, s) => sum + (s.stats.podiumsTotal || 0), 0);
  const totalRaces = statsData.reduce((sum, s) => sum + (s.stats.racesTotal || 0), 0);
  const bestUciRank = statsData.reduce<number | null>((best, s) => {
    if (!s.stats.uciRank) return best;
    return best === null || s.stats.uciRank < best ? s.stats.uciRank : best;
  }, null);
  const bestUciPoints = Math.max(...statsData.map(s => s.stats.uciPoints || 0), 0);
  const currentTeam = statsData.find(s => s.team)?.team || null;

  // Rumour sentiment
  const rScore = parseFloat(rumoursData.rumour?.aggregateScore || "0");
  const formSentiment = rScore > 0.3
    ? { label: "FORM ✓", cls: "bg-green-500/20 text-green-400 border-green-500/30" }
    : rScore < -0.3
    ? { label: "DOUBT", cls: "bg-red-500/20 text-red-400 border-red-500/30" }
    : null;

  const eloTier = getEloTier(bestElo);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground">
              <Link href="/riders" className="hover:text-foreground transition-colors">Riders</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{rider.name}</span>
            </nav>

            <div className="flex flex-col sm:flex-row gap-6 items-start">

              {/* Photo / Avatar */}
              <div className="shrink-0">
                {rider.photoUrl ? (
                  <div className="w-28 h-28 rounded-2xl overflow-hidden border border-border/50 bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={rider.photoUrl} alt={rider.name} className="w-full h-full object-cover object-top" />
                  </div>
                ) : (
                  <div className={`w-28 h-28 rounded-2xl flex items-center justify-center text-3xl font-black text-white bg-gradient-to-br from-primary/80 to-primary/40 border border-border/50`}>
                    {initials}
                  </div>
                )}
              </div>

              {/* Identity */}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {formSentiment && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${formSentiment.cls}`}>{formSentiment.label}</span>
                  )}
                  <Badge className={`${eloTier.color} text-white text-xs`}>{eloTier.label}</Badge>
                  {statsData.map(s => (
                    <Badge key={s.stats.id} variant="outline" className="text-xs capitalize">{s.stats.discipline}</Badge>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">
                    {rider.nationality && <span className="mr-2">{countryToFlag(rider.nationality)}</span>}
                    {rider.name}
                  </h1>
                  <FollowButton followType="rider" entityId={rider.id} entityName={rider.name} />
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {age && <span>{age} years old</span>}
                  {rider.birthDate && <span>· {format(new Date(rider.birthDate), "d MMM yyyy")}</span>}
                  {currentTeam && (
                    <span className="flex items-center gap-1">
                      ·&nbsp;
                      {currentTeam.website
                        ? <a href={currentTeam.website} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">{currentTeam.name}</a>
                        : currentTeam.name}
                    </span>
                  )}
                </div>

                {/* Team social links */}
                {currentTeam && (currentTeam.twitter || currentTeam.instagram) && (
                  <div className="flex items-center gap-3 text-xs">
                    {currentTeam.twitter && (
                      <a href={currentTeam.twitter} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                        𝕏 {currentTeam.name?.split(" ")[0]}
                      </a>
                    )}
                    {currentTeam.instagram && (
                      <a href={currentTeam.instagram} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                        📸 Instagram
                      </a>
                    )}
                  </div>
                )}

                {/* PCS / UCI IDs */}
                {(rider.pcsId || rider.uciId) && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground/60">
                    {rider.pcsId && (
                      <a href={`https://www.procyclingstats.com/rider/${rider.pcsId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="hover:text-primary transition-colors">
                        PCS: {rider.pcsId}
                      </a>
                    )}
                    {rider.uciId && (
                      <span>UCI ID: {rider.uciId}</span>
                    )}
                  </div>
                )}

                {/* Key stats strip */}
                <div className="flex flex-wrap gap-4 pt-2">
                  {bestElo > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{Math.round(bestElo)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">ELO</div>
                    </div>
                  )}
                  {totalWins > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{totalWins}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Wins</div>
                    </div>
                  )}
                  {totalPodiums > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{totalPodiums}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Podiums</div>
                    </div>
                  )}
                  {totalRaces > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{totalRaces}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Races</div>
                    </div>
                  )}
                  {bestUciPoints > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-black">{bestUciPoints.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">UCI pts</div>
                    </div>
                  )}
                  {bestUciRank && (
                    <div className="text-center">
                      <div className="text-xl font-black">#{bestUciRank}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">UCI rank</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── BIO ───────────────────────────────────────────────────────── */}
        {rider.bio && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-5">
              <p className="text-sm text-muted-foreground leading-relaxed">{rider.bio}</p>
              {rider.wikiSlug && (
                <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(rider.wikiSlug)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline mt-2 inline-block">
                  Full Wikipedia article →
                </a>
              )}
            </div>
          </section>
        )}

        {/* ── UPCOMING RACES ────────────────────────────────────────────── */}
        {upcomingRaces.length > 0 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-5">
              <h2 className="text-base font-bold mb-3">📅 Upcoming Races</h2>
              <div className="flex flex-wrap gap-2">
                {upcomingRaces.map(({ race, event }) => {
                  const slug = event.slug;
                  const href = slug ? `/races/${event.discipline}/${slug}` : `/races/${race.id}`;
                  return (
                    <Link key={race.id} href={href}
                      className="inline-flex flex-col px-3 py-2 rounded-lg border border-border/50 bg-card/30 hover:bg-card/70 transition-colors text-sm">
                      <span className="font-semibold truncate max-w-48">{event.name}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(race.date + "T12:00:00"), "d MMM yyyy")}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── FORM / INTEL ──────────────────────────────────────────────── */}
        {(rumoursData.rumour?.summary || rumoursData.tips.length > 0) && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-5">
              <h2 className="text-base font-bold mb-3">🔍 Rider Intel</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {rumoursData.rumour?.summary && (
                  <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Aggregate Intel</span>
                      {formSentiment && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${formSentiment.cls}`}>{formSentiment.label}</span>
                      )}
                      {(rumoursData.rumour.tipCount ?? 0) > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto">{rumoursData.rumour.tipCount} sources</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{rumoursData.rumour.summary}</p>
                    {rumoursData.rumour.lastUpdated && (
                      <p className="text-[10px] text-muted-foreground/50 mt-1">{formatDistanceToNow(rumoursData.rumour.lastUpdated, { addSuffix: true })}</p>
                    )}
                  </div>
                )}
                {rumoursData.tips.slice(0, 3).map((tip) => {
                  const s = parseFloat(tip.sentiment || "0");
                  const sLabel = s > 0.2 ? { l: "✓ Positive", c: "text-green-400" } : s < -0.2 ? { l: "⚠ Concern", c: "text-red-400" } : { l: "Neutral", c: "text-muted-foreground" };
                  return (
                    <div key={tip.id} className="rounded-lg border border-border/50 bg-card/30 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-semibold ${sLabel.c}`}>{sLabel.l}</span>
                        <span className="text-[10px] text-muted-foreground/50 ml-auto">
                          {formatDistanceToNow(new Date(tip.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{tip.tipText.substring(0, 120)}{tip.tipText.length > 120 ? "…" : ""}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── RESULTS + STATS ───────────────────────────────────────────── */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
          <div className="grid gap-6 lg:grid-cols-3">

            {/* Recent Results */}
            <div className="lg:col-span-2">
              <h2 className="text-base font-bold mb-3">🏁 Recent Results</h2>
              {resultsData.length > 0 ? (
                <div className="rounded-xl border border-border/50 divide-y divide-border/30">
                  {resultsData.map(({ result, race }) => (
                    <Link key={result.id} href={`/races/${race.id}`}
                      className="flex items-center gap-3 py-2.5 px-3 hover:bg-muted/50 transition-colors">
                      <div className="w-10 shrink-0 text-center">
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
                        <p className="text-sm font-medium truncate">{race.name}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(race.date + "T12:00:00"), "d MMM yyyy")}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
                  No recorded results yet
                </div>
              )}
            </div>

            {/* Sidebar: Discipline Stats + Links */}
            <div className="space-y-4">
              {statsData.map(({ stats, team }) => {
                const elo = parseFloat(stats.currentElo || "0");
                const affinities = (stats.profileAffinities as Record<string, number>) || {};
                const topAffinities = Object.entries(affinities)
                  .filter(([, v]) => v > 0.1)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3);
                return (
                  <div key={stats.id} className="rounded-xl border border-border/50 bg-card/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold capitalize">{stats.discipline}</span>
                      {elo > 0 && <span className="text-xs text-muted-foreground">ELO {Math.round(elo)}</span>}
                    </div>
                    {elo > 0 && (
                      <div>
                        <Progress value={Math.min((elo / 2000) * 100, 100)} className="h-1.5" />
                      </div>
                    )}
                    {topAffinities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {topAffinities.map(([profile]) => (
                          <span key={profile} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground capitalize">
                            {getSpecialtyIcon(profile)} {profile}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div><div className="font-bold">{stats.winsTotal || 0}</div><div className="text-muted-foreground">Wins</div></div>
                      <div><div className="font-bold">{stats.podiumsTotal || 0}</div><div className="text-muted-foreground">Podiums</div></div>
                      <div><div className="font-bold">{stats.racesTotal || 0}</div><div className="text-muted-foreground">Races</div></div>
                    </div>
                    {stats.uciPoints ? (
                      <div className="text-xs text-muted-foreground pt-1 border-t border-border/30">
                        UCI {stats.uciRank ? `#${stats.uciRank}` : "–"} · {stats.uciPoints} pts
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* External Links */}
              <div className="rounded-xl border border-border/50 bg-card/20 p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Links</p>
                {(rider.pcsUrl || rider.pcsId) && (
                  <a href={rider.pcsUrl || `https://www.procyclingstats.com/rider/${rider.pcsId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>📊</span> ProCyclingStats
                  </a>
                )}
                {rider.uciId && (
                  <a href={`https://www.uci.org/en/road/rankings/athlete/${rider.uciId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>🏅</span> UCI Rankings
                  </a>
                )}
                {rider.uciId && (
                  <a href={`https://firstcycling.com/rider.php?r=${rider.uciId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>🔢</span> FirstCycling
                  </a>
                )}
                {rider.wikiSlug && (
                  <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(rider.wikiSlug)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>📖</span> Wikipedia
                  </a>
                )}
                {rider.instagramHandle && (
                  <a href={`https://instagram.com/${rider.instagramHandle}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>📸</span> @{rider.instagramHandle}
                  </a>
                )}
                {rider.stravaId && (
                  <a href={`https://www.strava.com/athletes/${rider.stravaId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                    <span>🚴</span> Strava
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
