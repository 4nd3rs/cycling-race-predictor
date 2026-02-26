import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db, races, raceEvents, raceResults, raceStartlist, riderRumours, riders, uciSyncRuns } from "@/lib/db";
import { desc, sql, count, isNotNull, gte } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CronJob {
  id: string;
  name: string;
  emoji: string;
  schedule: string;
  scheduleDesc: string;
  lastActivity: Date | null;
  lastActivityLabel: string;
  nextRun: Date;
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatRelative(date: Date | null): string {
  if (!date) return "never";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTimeFull(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Calculate next occurrence of a daily cron (Stockholm time) */
function nextDailyRun(hour: number, minute = 0): Date {
  const now = new Date();
  // Convert to Stockholm time offset (CET=+1, CEST=+2)
  const stockholm = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
  const next = new Date(stockholm);
  next.setHours(hour, minute, 0, 0);
  if (next <= stockholm) next.setDate(next.getDate() + 1);
  // Adjust back to UTC
  const offset = now.getTime() - stockholm.getTime();
  return new Date(next.getTime() + offset);
}

/** Next occurrence of weekday (0=Sun..6=Sat) + time */
function nextWeekdayRun(weekday: number, hour: number, minute = 0): Date {
  const now = new Date();
  const stockholm = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
  const next = new Date(stockholm);
  next.setHours(hour, minute, 0, 0);
  const daysUntil = (weekday - stockholm.getDay() + 7) % 7;
  if (daysUntil === 0 && next <= stockholm) next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + daysUntil);
  const offset = now.getTime() - stockholm.getTime();
  return new Date(next.getTime() + offset);
}

/** Next occurrence of every-N-hours cron */
function nextIntervalRun(intervalHours: number): Date {
  const now = new Date();
  const nextMs = Math.ceil(now.getTime() / (intervalHours * 3600_000)) * (intervalHours * 3600_000);
  return new Date(nextMs);
}

function staleness(last: Date | null): "fresh" | "stale" | "old" | "never" {
  if (!last) return "never";
  const h = (Date.now() - last.getTime()) / 3_600_000;
  if (h < 4) return "fresh";
  if (h < 24) return "stale";
  return "old";
}

function StaleBadge({ status }: { status: "fresh" | "stale" | "old" | "never" }) {
  const map: Record<string, string> = {
    fresh: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    stale: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    old:   "bg-red-500/20   text-red-400   border border-red-500/30",
    never: "bg-zinc-500/20  text-zinc-400  border border-zinc-500/30",
  };
  const label = { fresh: "✓ recent", stale: "⚠ stale", old: "✗ old", never: "— never" };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

// ─── DB stats section ─────────────────────────────────────────────────────────
async function getStats() {
  const [
    totalRaces,
    racesWithResults,
    totalRiders,
    totalStartlistEntries,
    totalRumours,
    totalResults,
    upcomingRaces,
    recentResults,
    recentRumours,
    recentStartlist,
    lastCalendarEvent,
    lastUciSync,
  ] = await Promise.all([
    db.select({ c: count() }).from(races),
    db.select({ c: count() }).from(races).where(sql`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id) > 0`),
    db.select({ c: count() }).from(riders),
    db.select({ c: count() }).from(raceStartlist),
    db.select({ c: count() }).from(riderRumours),
    db.select({ c: count() }).from(raceResults),
    db.select({ c: count() }).from(races).where(gte(races.date, sql`CURRENT_DATE`)),
    db.select({ createdAt: raceResults.createdAt }).from(raceResults).orderBy(desc(raceResults.createdAt)).limit(1),
    db.select({ updatedAt: riderRumours.lastUpdated }).from(riderRumours).orderBy(desc(riderRumours.lastUpdated)).limit(1),
    db.select({ createdAt: raceStartlist.createdAt }).from(raceStartlist).orderBy(desc(raceStartlist.createdAt)).limit(1),
    db.select({ createdAt: raceEvents.createdAt }).from(raceEvents).orderBy(desc(raceEvents.createdAt)).limit(1),
    db.select().from(uciSyncRuns).orderBy(desc(uciSyncRuns.startedAt)).limit(1),
  ]);

  return {
    totalRaces: totalRaces[0]?.c ?? 0,
    racesWithResults: racesWithResults[0]?.c ?? 0,
    totalRiders: totalRiders[0]?.c ?? 0,
    totalStartlistEntries: totalStartlistEntries[0]?.c ?? 0,
    totalRumours: totalRumours[0]?.c ?? 0,
    totalResults: totalResults[0]?.c ?? 0,
    upcomingRaces: upcomingRaces[0]?.c ?? 0,
    lastResultsImport: recentResults[0]?.createdAt ?? null,
    lastRumourUpdate: recentRumours[0]?.updatedAt as Date | null ?? null,
    lastStartlistEntry: recentStartlist[0]?.createdAt ?? null,
    lastCalendarEvent: lastCalendarEvent[0]?.createdAt ?? null,
    lastUciSync: lastUciSync[0]?.startedAt ?? null,
    lastUciSyncStatus: lastUciSync[0]?.status ?? null,
  };
}

// ─── Recent activity feed ─────────────────────────────────────────────────────
async function getRecentActivity() {
  const [recentRaceResults, recentRumourList, recentRacesList] = await Promise.all([
    db.select({
      id: raceResults.id,
      createdAt: raceResults.createdAt,
      raceId: raceResults.raceId,
    }).from(raceResults).orderBy(desc(raceResults.createdAt)).limit(5),

    db.select({
      id: riderRumours.id,
      updatedAt: riderRumours.lastUpdated,
      riderId: riderRumours.riderId,
      summary: riderRumours.summary,
    }).from(riderRumours).orderBy(desc(riderRumours.lastUpdated)).limit(5),

    db.select({
      id: races.id,
      name: races.name,
      createdAt: races.createdAt,
      date: races.date,
      status: races.status,
    }).from(races).orderBy(desc(races.createdAt)).limit(5),
  ]);

  return { recentRaceResults, recentRumourList, recentRacesList };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function CronsPage() {
  if (!(await isAdmin())) redirect("/");

  const stats = await getStats();
  const { recentRacesList, recentRumourList } = await getRecentActivity();

  // Build cron job definitions with inferred last-run from DB
  const crons: CronJob[] = [
    {
      id: "race-calendar",
      name: "Race Calendar Sync",
      emoji: "📅",
      schedule: "daily @ 06:00",
      scheduleDesc: "Every day at 06:00 Stockholm",
      lastActivity: stats.lastCalendarEvent,
      lastActivityLabel: "Last event created",
      nextRun: nextDailyRun(6),
      notes: "PCS road (WorldTour/Pro) + XCOdata MTB · 3-month window",
    },
    {
      id: "gossip-hunter",
      name: "Gossip Hunter",
      emoji: "📰",
      schedule: "daily @ 08:00",
      scheduleDesc: "Every day at 08:00 Stockholm",
      lastActivity: stats.lastRumourUpdate,
      lastActivityLabel: "Last rumour updated",
      nextRun: nextDailyRun(8),
      notes: "Scrapes cycling news → rider_rumours table",
    },
    {
      id: "marketing-agent",
      name: "Marketing Agent",
      emoji: "📸",
      schedule: "daily @ 09:00",
      scheduleDesc: "Every day at 09:00 Stockholm",
      lastActivity: null,
      lastActivityLabel: "Posts to Telegram (no DB trace)",
      nextRun: nextDailyRun(9),
      notes: "Posts preview/results cards to @procyclingpredictions",
    },
    {
      id: "uci-sync",
      name: "UCI Rankings Sync",
      emoji: "📊",
      schedule: "Tue @ 14:00",
      scheduleDesc: "Every Tuesday at 14:00 Stockholm",
      lastActivity: stats.lastUciSync,
      lastActivityLabel: `Last sync${stats.lastUciSyncStatus ? ` (${stats.lastUciSyncStatus})` : ""}`,
      nextRun: nextWeekdayRun(2, 14),
      notes: "PCS /rankings/me/uci-individual · Playwright · road discipline",
    },
    {
      id: "results-hunter",
      name: "Results Hunter",
      emoji: "🏁",
      schedule: "every 6h",
      scheduleDesc: "00:00, 06:00, 12:00, 18:00 Stockholm",
      lastActivity: stats.lastResultsImport,
      lastActivityLabel: "Last result imported",
      nextRun: nextIntervalRun(6),
      notes: "Scrapes results for completed races · updates race status",
    },
    {
      id: "startlist-sync",
      name: "Startlist Sync",
      emoji: "📋",
      schedule: "every 1h",
      scheduleDesc: "Runs every hour",
      lastActivity: stats.lastStartlistEntry,
      lastActivityLabel: "Last startlist entry",
      nextRun: nextIntervalRun(1),
      notes: "PCS Playwright scraper · syncs upcoming race startlists",
    },
  ];

  const statCards = [
    { label: "Total Races", value: Number(stats.totalRaces), sub: `${Number(stats.upcomingRaces)} upcoming` },
    { label: "With Results", value: Number(stats.racesWithResults), sub: `${Number(stats.totalResults)} result rows` },
    { label: "Riders", value: Number(stats.totalRiders), sub: "all disciplines" },
    { label: "Startlist Entries", value: Number(stats.totalStartlistEntries), sub: "across all races" },
    { label: "Intel / Rumours", value: Number(stats.totalRumours), sub: "rider rumours" },
  ];

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-semibold">Cron Jobs & Data Pipeline</h2>
        <p className="text-sm text-muted-foreground mt-1">
          All jobs run on the Mac mini via OpenClaw. Vercel is read-only frontend.
        </p>
      </div>

      {/* ── DB Stats ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold tabular-nums">{Number(s.value).toLocaleString()}</p>
              <p className="text-xs font-medium mt-0.5">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Cron Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Scheduled Jobs</CardTitle>
          <CardDescription>Last activity inferred from DB timestamps · next run in Stockholm time</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Job</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Schedule</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Next Run</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Activity</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((job, i) => (
                  <tr
                    key={job.id}
                    className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{job.emoji}</span>
                        <div>
                          <p className="font-medium">{job.name}</p>
                          <p className="text-xs text-muted-foreground max-w-[220px] truncate">{job.notes}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">{job.schedule}</span>
                      <p className="text-xs text-muted-foreground mt-1">{job.scheduleDesc}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{formatRelative(job.nextRun)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(job.nextRun)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {job.lastActivity ? formatRelative(job.lastActivity) : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{job.lastActivityLabel}</p>
                      {job.lastActivity && (
                        <p className="text-xs text-muted-foreground/70">{formatDateTimeFull(job.lastActivity)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StaleBadge status={job.id === "marketing-agent" ? "fresh" : staleness(job.lastActivity)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent Activity ── */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Recent races added */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">📅 Recently Added Races</CardTitle>
            <CardDescription>Last 5 race records created (Race Scout / Calendar)</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {recentRacesList.map((r, i) => (
                  <tr key={r.id} className={`border-b border-border/30 px-4 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-2 max-w-[200px]">
                      <p className="truncate font-medium text-xs">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.date}</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${r.status === "completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`}>
                        {r.status ?? "upcoming"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelative(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Recent rumours */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">📰 Recent Intel</CardTitle>
            <CardDescription>Latest rider rumours (Gossip Hunter)</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {recentRumourList.map((r, i) => (
                  <tr key={r.id} className={`border-b border-border/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-2">
                      <p className="text-xs line-clamp-2 text-muted-foreground">
                        {r.summary ?? "(no summary)"}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelative(r.updatedAt ?? null)}
                    </td>
                  </tr>
                ))}
                {recentRumourList.length === 0 && (
                  <tr><td className="px-4 py-4 text-center text-sm text-muted-foreground">No rumours yet</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── OpenClaw IDs ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">🔧 OpenClaw Cron IDs</CardTitle>
          <CardDescription>Use these to manage jobs via OpenClaw CLI</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs">
            {[
              { id: "331190a4", name: "Race Scout",     cmd: "openclaw cron show 331190a4" },
              { id: "ff1d4dbd", name: "Results Hunter", cmd: "openclaw cron show ff1d4dbd" },
              { id: "d6653813", name: "Gossip Hunter",  cmd: "openclaw cron show d6653813" },
            ].map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground w-20 shrink-0">{c.name}</span>
                <span className="text-primary/80">{c.id}</span>
                <span className="text-muted-foreground">→</span>
                <code className="text-muted-foreground">{c.cmd}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
