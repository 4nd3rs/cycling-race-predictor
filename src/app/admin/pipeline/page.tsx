import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  db,
  races,
  riders,
  raceResults,
  raceStartlist,
  uciSyncRuns,
  eloHistory,
  riderDisciplineStats,
} from "@/lib/db";
import { desc, sql, count, gte, and, lte, isNull, eq, isNotNull } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(date: Date | string | null): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

interface ScrapeStatusComponent {
  component: string;
  status: string;
  summary: string;
  updatedAt: string;
  raceRows?: Array<{
    name: string;
    date: string;
    count: number;
    status: string;
    scrapedAt: string;
  }>;
}

interface ScrapeStatus {
  calendar?: ScrapeStatusComponent;
  startlists?: ScrapeStatusComponent;
  results?: ScrapeStatusComponent;
  "mtb-results"?: ScrapeStatusComponent;
}

function readScrapeStatus(): ScrapeStatus {
  try {
    const filePath = path.join(process.cwd(), "SCRAPE_STATUS.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/<!-- STATUS_JSON\n([\s\S]*?)\nSTATUS_JSON -->/);
    if (match?.[1]) return JSON.parse(match[1]);
  } catch {
    // ignore
  }
  return {};
}

// ─── Data Queries ───────────────────────────────────────────────────────────

async function getPipelineData() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000).toISOString().split("T")[0];
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 86400_000).toISOString().split("T")[0];
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

  const [
    // Race Calendar
    racesByDisciplineResult,
    racesByCategoryResult,
    recentRacesResult,
    // Startlists
    upcomingRacesResult,
    // Results
    recentResultsResult,
    staleRacesResult,
    // ELO / Rankings
    lastUciSyncResult,
    recentEloResult,
    ridersNoEloResult,
  ] = await Promise.all([
    // Race calendar: by discipline
    db.select({ discipline: races.discipline, c: count() })
      .from(races)
      .groupBy(races.discipline),
    // Race calendar: by category
    db.select({ uciCategory: races.uciCategory, c: count() })
      .from(races)
      .groupBy(races.uciCategory),
    // Races added last 7 days
    db.select({ id: races.id, name: races.name, date: races.date, discipline: races.discipline })
      .from(races)
      .where(gte(races.createdAt, new Date(now.getTime() - 7 * 86400_000)))
      .orderBy(desc(races.createdAt))
      .limit(20),
    // Upcoming races for startlist coverage (next 14 days)
    db.select({
      id: races.id,
      name: races.name,
      date: races.date,
      pcsUrl: races.pcsUrl,
    })
      .from(races)
      .where(and(gte(races.date, today), lte(races.date, fourteenDaysFromNow)))
      .orderBy(races.date),
    // Results imported last 7 days
    db.select({
      raceId: raceResults.raceId,
      c: count(),
      createdAt: sql<Date>`max(${raceResults.createdAt})`,
    })
      .from(raceResults)
      .where(gte(raceResults.createdAt, new Date(now.getTime() - 7 * 86400_000)))
      .groupBy(raceResults.raceId)
      .limit(20),
    // Stale races (past, no results)
    db.select({ id: races.id, name: races.name, date: races.date })
      .from(races)
      .where(and(
        sql`${races.date} < ${today}`,
        sql`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id) = 0`,
      ))
      .orderBy(desc(races.date))
      .limit(20),
    // UCI sync
    db.select().from(uciSyncRuns).orderBy(desc(uciSyncRuns.startedAt)).limit(5),
    // ELO history (last 24h)
    db.select({
      id: eloHistory.id,
      riderId: eloHistory.riderId,
      discipline: eloHistory.discipline,
      eloBefore: eloHistory.eloBefore,
      eloAfter: eloHistory.eloAfter,
      eloChange: eloHistory.eloChange,
      racePosition: eloHistory.racePosition,
      createdAt: eloHistory.createdAt,
    })
      .from(eloHistory)
      .where(gte(eloHistory.createdAt, twentyFourHoursAgo))
      .orderBy(desc(eloHistory.createdAt))
      .limit(20),
    // Riders with no ELO
    db.select({ c: count() })
      .from(riders)
      .where(sql`NOT EXISTS (SELECT 1 FROM rider_discipline_stats rds WHERE rds.rider_id = riders.id AND rds.current_elo IS NOT NULL AND rds.current_elo != '1500')`),
  ]);

  // Get startlist counts for upcoming races
  const upcomingIds = upcomingRacesResult.map((r) => r.id);
  let startlistCounts: Record<string, number> = {};
  if (upcomingIds.length > 0) {
    const slCounts = await db
      .select({ raceId: raceStartlist.raceId, c: count() })
      .from(raceStartlist)
      .where(sql`${raceStartlist.raceId} IN ${upcomingIds}`)
      .groupBy(raceStartlist.raceId);
    startlistCounts = Object.fromEntries(slCounts.map((r) => [r.raceId, r.c]));
  }

  // Get race names for recent results
  const resultRaceIds = recentResultsResult.map((r) => r.raceId);
  let raceNames: Record<string, string> = {};
  if (resultRaceIds.length > 0) {
    const raceNameRows = await db
      .select({ id: races.id, name: races.name })
      .from(races)
      .where(sql`${races.id} IN ${resultRaceIds}`);
    raceNames = Object.fromEntries(raceNameRows.map((r) => [r.id, r.name]));
  }

  const upcomingWithStartlist = upcomingRacesResult.map((r) => ({
    ...r,
    startlistCount: startlistCounts[r.id] ?? 0,
  }));

  const totalUpcoming = upcomingWithStartlist.length;
  const withStartlist = upcomingWithStartlist.filter((r) => r.startlistCount > 0).length;
  const coveragePct = totalUpcoming > 0 ? Math.round((withStartlist / totalUpcoming) * 100) : 0;

  return {
    racesByDiscipline: racesByDisciplineResult,
    racesByCategory: racesByCategoryResult,
    recentRaces: recentRacesResult,
    upcomingWithStartlist,
    startlistCoverage: { total: totalUpcoming, withStartlist, pct: coveragePct },
    recentResults: recentResultsResult.map((r) => ({
      ...r,
      raceName: raceNames[r.raceId] ?? r.raceId,
    })),
    staleRaces: staleRacesResult,
    uciSyncRuns: lastUciSyncResult,
    recentElo: recentEloResult,
    ridersNoElo: ridersNoEloResult[0]?.c ?? 0,
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function PipelinePage() {
  if (!(await isAdmin())) redirect("/");

  const data = await getPipelineData();
  const scrapeStatus = readScrapeStatus();

  const missingStartlist = data.upcomingWithStartlist.filter((r) => r.startlistCount === 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Pipeline</h2>
        <p className="text-sm text-muted-foreground">Deep dive into each pipeline component</p>
      </div>

      {/* ── Scrape Credits ── */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle>Scrape Credits</CardTitle>
          <CardDescription>scrape.do API usage</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Check balance at{" "}
            <span className="font-mono text-xs">scrape.do/dashboard</span>.
            XCOdata uses plain fetch (free) — scrape.do only for PCS results.
          </p>
        </CardContent>
      </Card>

      {/* ── Race Calendar ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>📅 Race Calendar</CardTitle>
          <CardDescription>
            Last sync: {scrapeStatus.calendar?.updatedAt ? formatRelative(scrapeStatus.calendar.updatedAt) : "—"}
            {scrapeStatus.calendar?.summary && ` — ${scrapeStatus.calendar.summary}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* By discipline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Races by Discipline</p>
            <div className="flex flex-wrap gap-2">
              {data.racesByDiscipline.map((d) => (
                <Badge key={d.discipline} variant="outline">
                  {d.discipline}: {Number(d.c).toLocaleString()}
                </Badge>
              ))}
            </div>
          </div>
          {/* By category */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Races by UCI Category</p>
            <div className="flex flex-wrap gap-2">
              {data.racesByCategory
                .filter((c) => c.uciCategory)
                .map((c) => (
                  <Badge key={c.uciCategory} variant="secondary" className="text-xs">
                    {c.uciCategory}: {Number(c.c)}
                  </Badge>
                ))}
            </div>
          </div>
          {/* Recently added */}
          {data.recentRaces.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Added last 7 days ({data.recentRaces.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {data.recentRaces.map((r, i) => (
                      <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[250px] truncate">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-xs">{r.discipline}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Startlists ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>📋 Startlists</CardTitle>
          <CardDescription>
            Last sync: {scrapeStatus.startlists?.updatedAt ? formatRelative(scrapeStatus.startlists.updatedAt) : "—"}
            {" — "}Coverage: {data.startlistCoverage.withStartlist}/{data.startlistCoverage.total} races ({data.startlistCoverage.pct}%)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {missingStartlist.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Missing startlists (next 14 days): {missingStartlist.length}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Race</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">PCS URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingStartlist.map((r, i) => (
                      <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[250px] truncate">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {r.pcsUrl ? "✅" : <span className="text-yellow-500">missing</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">All upcoming races have startlists.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Results ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>🏁 Results</CardTitle>
          <CardDescription>
            Road: {scrapeStatus.results?.updatedAt ? formatRelative(scrapeStatus.results.updatedAt) : "—"}
            {" | "}MTB: {scrapeStatus["mtb-results"]?.updatedAt ? formatRelative(scrapeStatus["mtb-results"].updatedAt) : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.recentResults.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Imported last 7 days</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Race</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentResults.map((r, i) => (
                      <tr key={r.raceId} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[300px] truncate">{r.raceName}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.staleRaces.length > 0 && (
            <div>
              <p className="text-xs font-medium text-yellow-500 mb-2">
                Stale races (past, no results): {data.staleRaces.length}
              </p>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {data.staleRaces.map((r, i) => (
                      <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5 max-w-[300px] truncate">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── ELO / Rankings ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>🏆 ELO / Rankings</CardTitle>
          <CardDescription>
            Last UCI sync: {data.uciSyncRuns[0]?.startedAt ? formatRelative(data.uciSyncRuns[0].startedAt) : "—"}
            {" — "}{Number(data.ridersNoElo).toLocaleString()} riders with no ELO
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* UCI Sync Runs */}
          {data.uciSyncRuns.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Recent UCI Syncs</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">When</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Entries</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Created</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.uciSyncRuns.map((run, i) => (
                      <tr key={run.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-1.5">
                          <Badge
                            variant={run.status === "completed" ? "default" : run.status === "running" ? "secondary" : "destructive"}
                            className="text-xs"
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{formatRelative(run.startedAt)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.totalEntries ?? 0}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.ridersCreated ?? 0}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.ridersUpdated ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent ELO changes */}
          {data.recentElo.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">ELO Changes (last 24h)</p>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Discipline</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Position</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Before</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">After</th>
                      <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentElo.map((e, i) => {
                      const change = Number(e.eloChange ?? 0);
                      return (
                        <tr key={e.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                          <td className="px-3 py-1.5">{e.discipline}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{e.racePosition ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(e.eloBefore ?? 0).toFixed(0)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(e.eloAfter ?? 0).toFixed(0)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${change > 0 ? "text-emerald-500" : change < 0 ? "text-red-400" : ""}`}>
                            {change > 0 ? "+" : ""}{change.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.recentElo.length === 0 && (
            <p className="text-sm text-muted-foreground">No ELO changes in the last 24 hours.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        Data as of {new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}
      </p>
    </div>
  );
}
