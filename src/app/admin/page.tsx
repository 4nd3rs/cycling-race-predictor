import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db, uciSyncRuns } from "@/lib/db";
import { desc } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SyncButton } from "@/components/admin/sync-button";

// Don't prerender - this page always needs fresh data
export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "completed"
    ? "default"
    : status === "running"
    ? "secondary"
    : "destructive";

  return <Badge variant={variant}>{status}</Badge>;
}

export default async function AdminPage() {
  if (!(await isAdmin())) {
    redirect("/");
  }

  const runs = await db
    .select()
    .from(uciSyncRuns)
    .orderBy(desc(uciSyncRuns.startedAt))
    .limit(10);

  const latestRun = runs[0] || null;

  return (
    <div className="space-y-6">
      {/* Last Sync Card */}
      <div className="flex items-start justify-between gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>UCI Rankings Sync</CardTitle>
            <CardDescription>
              Last sync status and controls
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestRun ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status={latestRun.status} />
                  <span className="text-sm text-muted-foreground">
                    {formatRelativeTime(latestRun.startedAt)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(latestRun.durationMs)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Total Entries" value={latestRun.totalEntries ?? 0} />
                  <Stat label="Riders Created" value={latestRun.ridersCreated ?? 0} />
                  <Stat label="Riders Updated" value={latestRun.ridersUpdated ?? 0} />
                  <Stat label="Teams Created" value={latestRun.teamsCreated ?? 0} />
                </div>
                {latestRun.errors && (latestRun.errors as string[]).length > 0 && (
                  <div className="mt-2 rounded-md bg-destructive/10 p-3">
                    <p className="text-sm font-medium text-destructive">Errors:</p>
                    <ul className="mt-1 list-inside list-disc text-sm text-destructive">
                      {(latestRun.errors as string[]).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sync runs yet.</p>
            )}
          </CardContent>
        </Card>
        <div className="pt-6">
          <SyncButton />
        </div>
      </div>

      {/* Category Breakdown */}
      {latestRun?.categoryDetails && (latestRun.categoryDetails as Array<{
        category: string;
        entries: number;
        ridersCreated: number;
        ridersUpdated: number;
      }>).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>Latest sync per-category stats</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Category</th>
                    <th className="py-2 text-right font-medium">Entries</th>
                    <th className="py-2 text-right font-medium">Created</th>
                    <th className="py-2 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(latestRun.categoryDetails as Array<{
                    category: string;
                    entries: number;
                    ridersCreated: number;
                    ridersUpdated: number;
                  }>).map((cat) => (
                    <tr key={cat.category} className="border-b last:border-0">
                      <td className="py-2">{cat.category}</td>
                      <td className="py-2 text-right">{cat.entries}</td>
                      <td className="py-2 text-right">{cat.ridersCreated}</td>
                      <td className="py-2 text-right">{cat.ridersUpdated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync History */}
      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sync History</CardTitle>
            <CardDescription>Last 10 sync runs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-left font-medium">Started</th>
                    <th className="py-2 text-right font-medium">Duration</th>
                    <th className="py-2 text-right font-medium">Entries</th>
                    <th className="py-2 text-right font-medium">Created</th>
                    <th className="py-2 text-right font-medium">Updated</th>
                    <th className="py-2 text-right font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="py-2">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-2">
                        {formatRelativeTime(run.startedAt)}
                      </td>
                      <td className="py-2 text-right">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="py-2 text-right">{run.totalEntries ?? 0}</td>
                      <td className="py-2 text-right">{run.ridersCreated ?? 0}</td>
                      <td className="py-2 text-right">{run.ridersUpdated ?? 0}</td>
                      <td className="py-2 text-right">
                        {(run.errors as string[] | null)?.length || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
