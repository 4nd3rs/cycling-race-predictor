import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  db,
  races,
  riders,
  raceResults,
  raceNews,
  raceEvents,
  riderRumours,
  riderDisciplineStats,
} from "@/lib/db";
import { desc, sql, count, gte, and, lte, isNull, isNotNull, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(date: Date | null): string {
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Data ───────────────────────────────────────────────────────────────────

async function getDataQualityData() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekFromNow = new Date(now.getTime() + 7 * 86400_000).toISOString().split("T")[0];
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86400_000).toISOString().split("T")[0];

  const [
    // Rider coverage
    totalRidersResult,
    ridersWithUciResult,
    ridersWithBioResult,
    ridersWithTeamResult,
    ridersNoEloHistoryResult,
    // Race data issues
    racesMissingPcsUrlResult,
    racesLowResultsResult,
    duplicateRaceNamesResult,
    // News coverage
    raceNewsResult,
    eventsNoArticlesResult,
    // Rumours
    totalRumoursResult,
    recentRumoursResult,
  ] = await Promise.all([
    // Rider coverage
    db.select({ c: count() }).from(riders),
    db.select({ c: count() }).from(riderDisciplineStats).where(isNotNull(riderDisciplineStats.uciRank)),
    db.select({ c: count() }).from(riders).where(isNotNull(riders.bio)),
    db.select({ c: count() }).from(riders).where(isNotNull(riders.teamId)),
    db.select({ c: count() }).from(riders)
      .where(sql`NOT EXISTS (SELECT 1 FROM elo_history eh WHERE eh.rider_id = riders.id)`),
    // Race data issues: missing pcs_url (upcoming 30 days)
    db.select({
      id: races.id,
      name: races.name,
      date: races.date,
      uciCategory: races.uciCategory,
    })
      .from(races)
      .where(and(
        gte(races.date, today),
        lte(races.date, thirtyDaysFromNow),
        isNull(races.pcsUrl),
      ))
      .orderBy(races.date)
      .limit(30),
    // Races with < 3 results
    db.select({
      id: races.id,
      name: races.name,
      date: races.date,
      resultCount: sql<number>`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id)`,
    })
      .from(races)
      .where(sql`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id) BETWEEN 1 AND 2`)
      .orderBy(desc(races.date))
      .limit(20),
    // Duplicate race names
    db.select({
      name: races.name,
      c: count(),
    })
      .from(races)
      .groupBy(races.name)
      .having(sql`count(*) > 1`)
      .limit(20),
    // News coverage for upcoming race events
    db.select({
      raceEventId: raceNews.raceEventId,
      articleCount: count(),
      lastArticle: sql<Date>`max(${raceNews.publishedAt})`,
    })
      .from(raceNews)
      .innerJoin(raceEvents, eq(raceNews.raceEventId, raceEvents.id))
      .where(and(gte(raceEvents.date, today), lte(raceEvents.date, thirtyDaysFromNow)))
      .groupBy(raceNews.raceEventId)
      .limit(30),
    // Events with 0 articles (next 7 days)
    db.select({
      id: raceEvents.id,
      name: raceEvents.name,
      date: raceEvents.date,
    })
      .from(raceEvents)
      .where(and(
        gte(raceEvents.date, today),
        lte(raceEvents.date, weekFromNow),
        sql`NOT EXISTS (SELECT 1 FROM race_news rn WHERE rn.race_event_id = race_events.id)`,
      ))
      .orderBy(raceEvents.date)
      .limit(20),
    // Rumours
    db.select({ c: count() }).from(riderRumours),
    db.select({
      id: riderRumours.id,
      riderId: riderRumours.riderId,
      aggregateScore: riderRumours.aggregateScore,
      tipCount: riderRumours.tipCount,
      summary: riderRumours.summary,
      lastUpdated: riderRumours.lastUpdated,
    })
      .from(riderRumours)
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(10),
  ]);

  // Get rider names for rumours
  const rumourRiderIds = recentRumoursResult.map((r) => r.riderId);
  let riderNames: Record<string, string> = {};
  if (rumourRiderIds.length > 0) {
    const nameRows = await db
      .select({ id: riders.id, name: riders.name })
      .from(riders)
      .where(sql`${riders.id} IN ${rumourRiderIds}`);
    riderNames = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
  }

  // Get event names for news
  const eventIds = raceNewsResult.map((r) => r.raceEventId);
  let eventNames: Record<string, string> = {};
  if (eventIds.length > 0) {
    const nameRows = await db
      .select({ id: raceEvents.id, name: raceEvents.name })
      .from(raceEvents)
      .where(sql`${raceEvents.id} IN ${eventIds}`);
    eventNames = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
  }

  // Rumour sentiment buckets
  const sentimentBuckets = { positive: 0, neutral: 0, negative: 0 };
  for (const r of recentRumoursResult) {
    const score = Number(r.aggregateScore ?? 0);
    if (score > 0.2) sentimentBuckets.positive++;
    else if (score < -0.2) sentimentBuckets.negative++;
    else sentimentBuckets.neutral++;
  }

  const totalRiders = Number(totalRidersResult[0]?.c ?? 0);

  return {
    riders: {
      total: totalRiders,
      withUci: Number(ridersWithUciResult[0]?.c ?? 0),
      withBio: Number(ridersWithBioResult[0]?.c ?? 0),
      withTeam: Number(ridersWithTeamResult[0]?.c ?? 0),
      noEloHistory: Number(ridersNoEloHistoryResult[0]?.c ?? 0),
    },
    racesMissingPcsUrl: racesMissingPcsUrlResult,
    racesLowResults: racesLowResultsResult,
    duplicateNames: duplicateRaceNamesResult,
    newsPerEvent: raceNewsResult.map((r) => ({
      eventId: r.raceEventId,
      eventName: eventNames[r.raceEventId] ?? r.raceEventId,
      articleCount: Number(r.articleCount),
      lastArticle: r.lastArticle,
    })),
    eventsNoArticles: eventsNoArticlesResult,
    rumours: {
      total: Number(totalRumoursResult[0]?.c ?? 0),
      sentiment: sentimentBuckets,
      recent: recentRumoursResult.map((r) => ({
        ...r,
        riderName: riderNames[r.riderId] ?? r.riderId,
      })),
    },
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function DataQualityPage() {
  if (!(await isAdmin())) redirect("/");

  const data = await getDataQualityData();
  const pct = (n: number) => data.riders.total > 0 ? Math.round((n / data.riders.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Data Quality</h2>
        <p className="text-sm text-muted-foreground">Data problems that affect prediction accuracy</p>
      </div>

      {/* ── Rider Coverage ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Rider Coverage</CardTitle>
          <CardDescription>{data.riders.total.toLocaleString()} total riders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CoverageItem
              label="UCI Ranking"
              value={data.riders.withUci}
              total={data.riders.total}
              pct={pct(data.riders.withUci)}
            />
            <CoverageItem
              label="Bio"
              value={data.riders.withBio}
              total={data.riders.total}
              pct={pct(data.riders.withBio)}
            />
            <CoverageItem
              label="Team Assigned"
              value={data.riders.withTeam}
              total={data.riders.total}
              pct={pct(data.riders.withTeam)}
            />
            <div>
              <p className="text-lg font-bold tabular-nums text-yellow-500">
                {data.riders.noEloHistory.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Never raced (no ELO history)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Race Data Issues ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Race Data Issues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Missing PCS URL */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Missing pcs_url (next 30 days): {data.racesMissingPcsUrl.length}
            </p>
            {data.racesMissingPcsUrl.length > 0 ? (
              <div className="overflow-x-auto max-h-[250px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Race</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.racesMissingPcsUrl.map((r, i) => (
                      <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[250px] truncate">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.uciCategory ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-emerald-500">All upcoming races have PCS URLs.</p>
            )}
          </div>

          {/* Low results */}
          {data.racesLowResults.length > 0 && (
            <div>
              <p className="text-xs font-medium text-yellow-500 mb-2">
                Races with &lt; 3 results (suspicious): {data.racesLowResults.length}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {data.racesLowResults.map((r, i) => (
                      <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[250px] truncate">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.resultCount)} results</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Duplicate names */}
          {data.duplicateNames.length > 0 && (
            <div>
              <p className="text-xs font-medium text-yellow-500 mb-2">
                Duplicate race names: {data.duplicateNames.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {data.duplicateNames.map((d) => (
                  <Badge key={d.name} variant="outline" className="text-xs">
                    {d.name} (x{Number(d.c)})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── News Coverage ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>News Coverage</CardTitle>
          <CardDescription>Race news for upcoming events</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.newsPerEvent.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Event</th>
                    <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Articles</th>
                    <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Last Article</th>
                  </tr>
                </thead>
                <tbody>
                  {data.newsPerEvent.map((e, i) => (
                    <tr key={e.eventId} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-3 py-1.5 max-w-[250px] truncate">{e.eventName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{e.articleCount}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{formatRelative(e.lastArticle)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.eventsNoArticles.length > 0 && (
            <div>
              <p className="text-xs font-medium text-yellow-500 mb-2">
                Events with 0 articles (next 7 days): {data.eventsNoArticles.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {data.eventsNoArticles.map((e) => (
                  <Badge key={e.id} variant="outline" className="text-xs">
                    {e.name} ({e.date})
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {data.newsPerEvent.length === 0 && data.eventsNoArticles.length === 0 && (
            <p className="text-sm text-muted-foreground">No upcoming events with news data.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Rumours / Gossip ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Rumours / Gossip</CardTitle>
          <CardDescription>
            {data.rumours.total} total rumours — Positive: {data.rumours.sentiment.positive}, Neutral: {data.rumours.sentiment.neutral}, Negative: {data.rumours.sentiment.negative}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Rider</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Sentiment</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Tips</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.rumours.recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No rumours yet
                    </td>
                  </tr>
                )}
                {data.rumours.recent.map((r, i) => {
                  const score = Number(r.aggregateScore ?? 0);
                  const sentiment = score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral";
                  return (
                    <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-2 font-medium">{r.riderName}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            sentiment === "positive"
                              ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                              : sentiment === "negative"
                              ? "bg-red-500/20 text-red-600 border-red-500/30 dark:text-red-400"
                              : "bg-zinc-500/20 text-zinc-600 border-zinc-500/30 dark:text-zinc-400"
                          }`}
                        >
                          {score > 0 ? "+" : ""}{score.toFixed(2)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.tipCount ?? 0}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{formatRelative(r.lastUpdated)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        Data as of {new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}
      </p>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function CoverageItem({
  label,
  value,
  total,
  pct,
}: {
  label: string;
  value: number;
  total: number;
  pct: number;
}) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums">
        {value.toLocaleString()}{" "}
        <span className="text-sm font-normal text-muted-foreground">/ {total.toLocaleString()}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {label} ({pct}%)
      </p>
    </div>
  );
}
