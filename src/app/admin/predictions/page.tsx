import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  db,
  races,
  predictions,
  raceStartlist,
  riders,
} from "@/lib/db";
import { desc, sql, count, gte, and, lte, eq } from "drizzle-orm";
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

async function getPredictionsData() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekFromNow = new Date(now.getTime() + 7 * 86400_000).toISOString().split("T")[0];
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 86400_000).toISOString().split("T")[0];

  const [
    totalPredictionsResult,
    racesWithPredsThisWeekResult,
    racesWithoutPredsThisWeekResult,
    // Races in next 14 days for quality table
    upcomingRacesResult,
    // Recent prediction batches
    recentBatchesResult,
  ] = await Promise.all([
    db.select({ c: count() }).from(predictions),
    db.select({ c: sql<number>`count(DISTINCT ${predictions.raceId})` })
      .from(predictions)
      .innerJoin(races, eq(predictions.raceId, races.id))
      .where(and(gte(races.date, today), lte(races.date, weekFromNow))),
    db.select({ c: count() })
      .from(races)
      .where(and(
        gte(races.date, today),
        lte(races.date, weekFromNow),
        sql`NOT EXISTS (SELECT 1 FROM predictions p WHERE p.race_id = races.id)`,
      )),
    db.select({
      id: races.id,
      name: races.name,
      date: races.date,
      discipline: races.discipline,
    })
      .from(races)
      .where(and(gte(races.date, today), lte(races.date, twoWeeksFromNow)))
      .orderBy(races.date)
      .limit(50),
    // Recent prediction runs — group by race + approximate generated_at
    db.select({
      raceId: predictions.raceId,
      c: count(),
      latestCreatedAt: sql<Date>`max(${predictions.createdAt})`,
    })
      .from(predictions)
      .groupBy(predictions.raceId)
      .orderBy(sql`max(${predictions.createdAt}) DESC`)
      .limit(10),
  ]);

  // For upcoming races, get prediction and startlist counts
  const upcomingIds = upcomingRacesResult.map((r) => r.id);
  let predCounts: Record<string, { count: number; latestAt: Date | null }> = {};
  let slCounts: Record<string, number> = {};

  if (upcomingIds.length > 0) {
    const [predRows, slRows] = await Promise.all([
      db.select({
        raceId: predictions.raceId,
        c: count(),
        latestAt: sql<Date>`max(${predictions.createdAt})`,
      })
        .from(predictions)
        .where(sql`${predictions.raceId} IN ${upcomingIds}`)
        .groupBy(predictions.raceId),
      db.select({ raceId: raceStartlist.raceId, c: count() })
        .from(raceStartlist)
        .where(sql`${raceStartlist.raceId} IN ${upcomingIds}`)
        .groupBy(raceStartlist.raceId),
    ]);
    predCounts = Object.fromEntries(predRows.map((r) => [r.raceId, { count: r.c, latestAt: r.latestAt }]));
    slCounts = Object.fromEntries(slRows.map((r) => [r.raceId, r.c]));
  }

  // Get race names for recent batches
  const batchRaceIds = recentBatchesResult.map((r) => r.raceId);
  let batchRaceNames: Record<string, string> = {};
  if (batchRaceIds.length > 0) {
    const nameRows = await db
      .select({ id: races.id, name: races.name })
      .from(races)
      .where(sql`${races.id} IN ${batchRaceIds}`);
    batchRaceNames = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
  }

  // Get top pick per batch race
  let topPicks: Record<string, string> = {};
  if (batchRaceIds.length > 0) {
    const topPickRows = await db
      .select({
        raceId: predictions.raceId,
        riderName: riders.name,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .where(and(
        sql`${predictions.raceId} IN ${batchRaceIds}`,
        eq(predictions.predictedPosition, 1),
      ));
    topPicks = Object.fromEntries(topPickRows.map((r) => [r.raceId, r.riderName]));
  }

  return {
    total: totalPredictionsResult[0]?.c ?? 0,
    racesThisWeek: racesWithPredsThisWeekResult[0]?.c ?? 0,
    racesWithoutPreds: racesWithoutPredsThisWeekResult[0]?.c ?? 0,
    qualityTable: upcomingRacesResult.map((r) => {
      const pred = predCounts[r.id];
      const sl = slCounts[r.id] ?? 0;
      const hasPreds = pred && pred.count > 0;
      const isStale = hasPreds && pred.latestAt && (Date.now() - pred.latestAt.getTime()) > 24 * 3600_000;
      return {
        ...r,
        predCount: pred?.count ?? 0,
        startlistSize: sl,
        generatedAt: pred?.latestAt ?? null,
        status: hasPreds ? (isStale ? "stale" : "ready") : "missing" as "ready" | "stale" | "missing",
      };
    }),
    recentBatches: recentBatchesResult.map((r) => ({
      raceId: r.raceId,
      raceName: batchRaceNames[r.raceId] ?? r.raceId,
      count: r.c,
      latestAt: r.latestCreatedAt,
      topPick: topPicks[r.raceId] ?? "—",
    })),
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function PredictionsPage() {
  if (!(await isAdmin())) redirect("/");

  const data = await getPredictionsData();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Predictions</h2>
        <p className="text-sm text-muted-foreground">Prediction coverage and quality</p>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">{Number(data.total).toLocaleString()}</p>
            <p className="text-xs font-medium">Total Predictions</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">{Number(data.racesThisWeek)}</p>
            <p className="text-xs font-medium">Races w/ Predictions (7d)</p>
          </CardContent>
        </Card>
        <Card className={`bg-card/50 ${Number(data.racesWithoutPreds) > 0 ? "border-yellow-500/50" : "border-border/50"}`}>
          <CardContent className="pt-4 pb-3">
            <p className={`text-2xl font-bold tabular-nums ${Number(data.racesWithoutPreds) > 0 ? "text-yellow-500" : ""}`}>
              {Number(data.racesWithoutPreds)}
            </p>
            <p className="text-xs font-medium">Missing Predictions (7d)</p>
            {Number(data.racesWithoutPreds) > 0 && (
              <p className="text-xs text-yellow-500 mt-0.5">Needs attention</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Prediction Quality Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Prediction Quality (next 14 days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Race</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Discipline</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Predictions</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Startlist</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Generated</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.qualityTable.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No upcoming races in the next 14 days
                    </td>
                  </tr>
                )}
                {data.qualityTable.map((r, i) => (
                  <tr key={r.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2 font-medium max-w-[220px] truncate">{r.name}</td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-xs">{r.discipline}</Badge>
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums">
                      {r.predCount > 0 ? r.predCount : <span className="text-red-400">0</span>}
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums">{r.startlistSize}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.generatedAt ? formatRelative(r.generatedAt) : "—"}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {r.status === "ready" && <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30 dark:text-emerald-400 text-xs" variant="outline">✅ ready</Badge>}
                      {r.status === "stale" && <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30 dark:text-yellow-400 text-xs" variant="outline">⚠️ stale</Badge>}
                      {r.status === "missing" && <Badge variant="destructive" className="text-xs">❌ missing</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent Prediction Runs ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent Prediction Runs</CardTitle>
          <CardDescription>Last 10 prediction batches</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Race</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Predictions</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Top Pick</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Generated</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBatches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No prediction runs yet
                    </td>
                  </tr>
                )}
                {data.recentBatches.map((b, i) => (
                  <tr key={b.raceId} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2 font-medium max-w-[250px] truncate">{b.raceName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(b.count)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{b.topPick}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {b.latestAt ? formatRelative(b.latestAt) : "—"}
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
