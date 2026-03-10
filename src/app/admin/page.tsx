import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  db,
  races,
  riders,
  predictions,
  users,
  raceResults,
  raceStartlist,
  uciSyncRuns,
  riderDisciplineStats,
} from "@/lib/db";
import { desc, sql, count, gte, and, lte, isNotNull, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
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

interface ScrapeStatus {
  calendar?: { component: string; status: string; summary: string; updatedAt: string };
  startlists?: { component: string; status: string; summary: string; updatedAt: string };
  results?: { component: string; status: string; summary: string; updatedAt: string };
  "mtb-results"?: { component: string; status: string; summary: string; updatedAt: string };
}

function readScrapeStatus(): ScrapeStatus {
  try {
    const filePath = path.join(process.cwd(), "SCRAPE_STATUS.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/<!-- STATUS_JSON\n([\s\S]*?)\nSTATUS_JSON -->/);
    if (match?.[1]) {
      return JSON.parse(match[1]);
    }
  } catch {
    // ignore
  }
  return {};
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30 dark:text-emerald-400" variant="outline">OK</Badge>;
  }
  if (status === "warn" || status === "stale") {
    return <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30 dark:text-yellow-400" variant="outline">Warning</Badge>;
  }
  return <Badge variant="destructive">{status}</Badge>;
}

// ─── Data Queries ───────────────────────────────────────────────────────────

async function getOverviewData() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekFromNow = new Date(now.getTime() + 7 * 86400_000).toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  const [
    totalRacesResult,
    racesThisWeekResult,
    racesWithResultsResult,
    staleRacesResult,
    totalRidersResult,
    ridersWithEloResult,
    ridersWithBioResult,
    ridersWithPhotoResult,
    totalPredictionsResult,
    racesWithPredictionsThisWeekResult,
    totalUsersResult,
    activeUsersResult,
    upcomingRacesResult,
    lastUciSyncResult,
  ] = await Promise.all([
    // Races
    db.select({ c: count() }).from(races),
    db.select({ c: count() }).from(races).where(and(gte(races.date, today), lte(races.date, weekFromNow))),
    db.select({ c: count() }).from(races).where(sql`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id) > 0`),
    db.select({ c: count() }).from(races).where(and(sql`${races.date} < ${today}`, sql`(SELECT count(*) FROM race_results rr WHERE rr.race_id = races.id) = 0`)),
    // Riders
    db.select({ c: count() }).from(riders),
    db.select({ c: count() }).from(riderDisciplineStats).where(sql`${riderDisciplineStats.currentElo} IS NOT NULL AND ${riderDisciplineStats.currentElo} != '1500'`),
    db.select({ c: count() }).from(riders).where(isNotNull(riders.bio)),
    db.select({ c: count() }).from(riders).where(isNotNull(riders.photoUrl)),
    // Predictions
    db.select({ c: count() }).from(predictions),
    db.select({ c: sql<number>`count(DISTINCT ${predictions.raceId})` }).from(predictions)
      .innerJoin(races, eq(predictions.raceId, races.id))
      .where(and(gte(races.date, today), lte(races.date, weekFromNow))),
    // Users
    db.select({ c: count() }).from(users),
    db.select({ c: count() }).from(users).where(gte(users.updatedAt, thirtyDaysAgo)),
    // Upcoming races (next 7 days)
    db.select({
      id: races.id,
      name: races.name,
      date: races.date,
      discipline: races.discipline,
      pcsUrl: races.pcsUrl,
    }).from(races)
      .where(and(gte(races.date, today), lte(races.date, weekFromNow)))
      .orderBy(races.date)
      .limit(30),
    // UCI sync
    db.select().from(uciSyncRuns).orderBy(desc(uciSyncRuns.startedAt)).limit(1),
  ]);

  // For upcoming races, check startlist and prediction counts
  const upcomingRaceIds = upcomingRacesResult.map((r) => r.id);
  let startlistCounts: Record<string, number> = {};
  let predictionCounts: Record<string, number> = {};
  let resultCounts: Record<string, number> = {};

  if (upcomingRaceIds.length > 0) {
    const [slCounts, predCounts, resCounts] = await Promise.all([
      db.select({ raceId: raceStartlist.raceId, c: count() })
        .from(raceStartlist)
        .where(sql`${raceStartlist.raceId} IN ${upcomingRaceIds}`)
        .groupBy(raceStartlist.raceId),
      db.select({ raceId: predictions.raceId, c: count() })
        .from(predictions)
        .where(sql`${predictions.raceId} IN ${upcomingRaceIds}`)
        .groupBy(predictions.raceId),
      db.select({ raceId: raceResults.raceId, c: count() })
        .from(raceResults)
        .where(sql`${raceResults.raceId} IN ${upcomingRaceIds}`)
        .groupBy(raceResults.raceId),
    ]);
    startlistCounts = Object.fromEntries(slCounts.map((r) => [r.raceId, r.c]));
    predictionCounts = Object.fromEntries(predCounts.map((r) => [r.raceId, r.c]));
    resultCounts = Object.fromEntries(resCounts.map((r) => [r.raceId, r.c]));
  }

  return {
    races: {
      total: totalRacesResult[0]?.c ?? 0,
      thisWeek: racesThisWeekResult[0]?.c ?? 0,
      withResults: racesWithResultsResult[0]?.c ?? 0,
      stale: staleRacesResult[0]?.c ?? 0,
    },
    riders: {
      total: totalRidersResult[0]?.c ?? 0,
      withElo: ridersWithEloResult[0]?.c ?? 0,
      withBio: ridersWithBioResult[0]?.c ?? 0,
      withPhoto: ridersWithPhotoResult[0]?.c ?? 0,
    },
    predictions: {
      total: totalPredictionsResult[0]?.c ?? 0,
      racesThisWeek: racesWithPredictionsThisWeekResult[0]?.c ?? 0,
    },
    users: {
      total: totalUsersResult[0]?.c ?? 0,
      activeLast30: activeUsersResult[0]?.c ?? 0,
    },
    upcomingRaces: upcomingRacesResult.map((r) => ({
      ...r,
      hasStartlist: (startlistCounts[r.id] ?? 0) > 0,
      hasPredictions: (predictionCounts[r.id] ?? 0) > 0,
      hasResults: (resultCounts[r.id] ?? 0) > 0,
    })),
    lastUciSync: lastUciSyncResult[0] ?? null,
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage() {
  if (!(await isAdmin())) redirect("/");

  const data = await getOverviewData();
  const scrapeStatus = readScrapeStatus();

  const pipelineItems = [
    {
      emoji: "📅",
      label: "Race Calendar",
      lastRun: scrapeStatus.calendar?.updatedAt ?? null,
      status: scrapeStatus.calendar?.status ?? "unknown",
      detail: scrapeStatus.calendar?.summary ?? "—",
    },
    {
      emoji: "📋",
      label: "Startlists",
      lastRun: scrapeStatus.startlists?.updatedAt ?? null,
      status: scrapeStatus.startlists?.status ?? "unknown",
      detail: scrapeStatus.startlists?.summary ?? "—",
    },
    {
      emoji: "🏁",
      label: "Road Results",
      lastRun: scrapeStatus.results?.updatedAt ?? null,
      status: scrapeStatus.results?.status ?? "unknown",
      detail: scrapeStatus.results?.summary ?? "—",
    },
    {
      emoji: "🏁",
      label: "MTB Results",
      lastRun: scrapeStatus["mtb-results"]?.updatedAt ?? null,
      status: scrapeStatus["mtb-results"]?.status ?? "unknown",
      detail: scrapeStatus["mtb-results"]?.summary ?? "—",
    },
    {
      emoji: "🔮",
      label: "Predictions",
      lastRun: null,
      status: data.predictions.total > 0 ? "ok" : "unknown",
      detail: `${Number(data.predictions.total).toLocaleString()} total predictions`,
    },
    {
      emoji: "🏆",
      label: "UCI Rankings",
      lastRun: data.lastUciSync?.startedAt?.toISOString() ?? null,
      status: data.lastUciSync?.status === "completed" ? "ok" : (data.lastUciSync?.status ?? "unknown"),
      detail: data.lastUciSync
        ? `${data.lastUciSync.ridersUpdated ?? 0} riders updated`
        : "—",
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Races"
          value={Number(data.races.total)}
          items={[
            { label: "this week", value: Number(data.races.thisWeek) },
            { label: "with results", value: Number(data.races.withResults) },
            { label: "stale (no results)", value: Number(data.races.stale), warn: Number(data.races.stale) > 0 },
          ]}
        />
        <StatCard
          title="Riders"
          value={Number(data.riders.total)}
          items={[
            { label: "with ELO", value: Number(data.riders.withElo) },
            { label: "with bio", value: Number(data.riders.withBio) },
            { label: "with photo", value: Number(data.riders.withPhoto) },
          ]}
        />
        <StatCard
          title="Predictions"
          value={Number(data.predictions.total)}
          items={[
            { label: "races w/ predictions (7d)", value: Number(data.predictions.racesThisWeek) },
          ]}
        />
        <StatCard
          title="Users"
          value={Number(data.users.total)}
          items={[
            { label: "active (30d)", value: Number(data.users.activeLast30) },
          ]}
        />
      </div>

      {/* ── Pipeline Health Strip ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Pipeline Health</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Component</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Last Run</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody>
                {pipelineItems.map((item, i) => (
                  <tr key={item.label} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2 font-medium">
                      <span className="mr-1.5">{item.emoji}</span>
                      {item.label}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {item.lastRun ? formatRelative(item.lastRun) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground max-w-[300px] truncate">
                      {item.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Upcoming Races ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Upcoming Races (next 7 days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Race</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Discipline</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Startlist</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Predictions</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Results</th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingRaces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No races in the next 7 days
                    </td>
                  </tr>
                )}
                {data.upcomingRaces.map((race, i) => (
                  <tr key={race.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2 font-medium max-w-[250px] truncate">{race.name}</td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{race.date}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-xs">{race.discipline}</Badge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {race.hasStartlist ? <span className="text-emerald-500">✅</span> : <span className="text-red-400">❌</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {race.hasPredictions ? <span className="text-emerald-500">✅</span> : <span className="text-red-400">❌</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {race.hasResults ? <span className="text-emerald-500">✅</span> : <span className="text-zinc-400">—</span>}
                    </td>
                  </tr>
                ))}
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

function StatCard({
  title,
  value,
  items,
}: {
  title: string;
  value: number;
  items: Array<{ label: string; value: number; warn?: boolean }>;
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="pt-4 pb-3">
        <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-xs font-medium mt-0.5">{title}</p>
        <div className="mt-2 space-y-0.5">
          {items.map((item) => (
            <p key={item.label} className={`text-xs ${item.warn ? "text-yellow-500" : "text-muted-foreground"}`}>
              {item.value.toLocaleString()} {item.label}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
