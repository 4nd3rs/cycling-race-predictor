import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  db,
  users,
  userTips,
  userTelegram,
  userWhatsapp,
  notificationLog,
  aiChatSessions,
  discussionThreads,
  discussionPosts,
} from "@/lib/db";
import { desc, sql, count, gte, and, eq, isNotNull } from "drizzle-orm";
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

function formatDate(date: Date): string {
  return date.toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Data ───────────────────────────────────────────────────────────────────

async function getUsersData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  const [
    totalUsersResult,
    usersLast7dResult,
    usersLast30dResult,
    totalChatSessionsResult,
    chatSessionsLast7dResult,
    telegramSubsResult,
    whatsappSubsResult,
    recentNotificationsResult,
    topTipUsersResult,
    totalThreadsResult,
    threadsLast7dResult,
    totalPostsResult,
    postsLast7dResult,
  ] = await Promise.all([
    db.select({ c: count() }).from(users),
    db.select({ c: count() }).from(users).where(gte(users.createdAt, sevenDaysAgo)),
    db.select({ c: count() }).from(users).where(gte(users.createdAt, thirtyDaysAgo)),
    db.select({ c: count() }).from(aiChatSessions),
    db.select({ c: count() }).from(aiChatSessions).where(gte(aiChatSessions.createdAt, sevenDaysAgo)),
    db.select({ c: count() }).from(userTelegram).where(isNotNull(userTelegram.telegramChatId)),
    db.select({ c: count() }).from(userWhatsapp).where(isNotNull(userWhatsapp.phoneNumber)),
    db.select({
      id: notificationLog.id,
      userId: notificationLog.userId,
      channel: notificationLog.channel,
      eventType: notificationLog.eventType,
      sentAt: notificationLog.sentAt,
    })
      .from(notificationLog)
      .orderBy(desc(notificationLog.sentAt))
      .limit(20),
    // Top engaged users by tip count
    db.select({
      userId: userTips.userId,
      tipCount: count(),
      lastTip: sql<Date>`max(${userTips.createdAt})`,
    })
      .from(userTips)
      .groupBy(userTips.userId)
      .orderBy(sql`count(*) DESC`)
      .limit(10),
    // Discussion threads
    db.select({ c: count() }).from(discussionThreads),
    db.select({ c: count() }).from(discussionThreads).where(gte(discussionThreads.createdAt, sevenDaysAgo)),
    // Discussion posts
    db.select({ c: count() }).from(discussionPosts),
    db.select({ c: count() }).from(discussionPosts).where(gte(discussionPosts.createdAt, sevenDaysAgo)),
  ]);

  // Get usernames for top tip users
  const tipUserIds = topTipUsersResult.map((r) => r.userId);
  let userNames: Record<string, string> = {};
  if (tipUserIds.length > 0) {
    const nameRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`${users.id} IN ${tipUserIds}`);
    userNames = Object.fromEntries(
      nameRows.map((r) => [r.id, r.name ?? r.email?.split("@")[0] ?? "anonymous"])
    );
  }

  return {
    summary: {
      total: Number(totalUsersResult[0]?.c ?? 0),
      last7d: Number(usersLast7dResult[0]?.c ?? 0),
      last30d: Number(usersLast30dResult[0]?.c ?? 0),
      chatTotal: Number(totalChatSessionsResult[0]?.c ?? 0),
      chatLast7d: Number(chatSessionsLast7dResult[0]?.c ?? 0),
    },
    notifications: {
      telegram: Number(telegramSubsResult[0]?.c ?? 0),
      whatsapp: Number(whatsappSubsResult[0]?.c ?? 0),
      recentLog: recentNotificationsResult,
    },
    topTipUsers: topTipUsersResult.map((r) => ({
      userId: r.userId,
      username: userNames[r.userId] ?? "anonymous",
      tipCount: Number(r.tipCount),
      lastTip: r.lastTip,
    })),
    discussions: {
      threadsTotal: Number(totalThreadsResult[0]?.c ?? 0),
      threadsLast7d: Number(threadsLast7dResult[0]?.c ?? 0),
      postsTotal: Number(totalPostsResult[0]?.c ?? 0),
      postsLast7d: Number(postsLast7dResult[0]?.c ?? 0),
    },
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function UsersPage() {
  if (!(await isAdmin())) redirect("/");

  const data = await getUsersData();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Users</h2>
        <p className="text-sm text-muted-foreground">User engagement and notification metrics</p>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">{data.summary.total.toLocaleString()}</p>
            <p className="text-xs font-medium">Total Users</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">{data.summary.last7d}</p>
            <p className="text-xs font-medium">Signed Up (7d)</p>
            <p className="text-xs text-muted-foreground">{data.summary.last30d} in 30d</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">{data.summary.chatTotal.toLocaleString()}</p>
            <p className="text-xs font-medium">AI Chat Sessions</p>
            <p className="text-xs text-muted-foreground">{data.summary.chatLast7d} last 7d</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold tabular-nums">
              {data.discussions.threadsTotal}
            </p>
            <p className="text-xs font-medium">Discussion Threads</p>
            <p className="text-xs text-muted-foreground">{data.discussions.postsTotal} posts total</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Notification Subscribers ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Notification Subscribers</CardTitle>
          <CardDescription>
            Telegram: {data.notifications.telegram} | WhatsApp: {data.notifications.whatsapp}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Channel</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Event</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data.notifications.recentLog.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No notifications sent yet
                    </td>
                  </tr>
                )}
                {data.notifications.recentLog.map((n, i) => (
                  <tr key={n.id} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-xs">{n.channel}</Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{n.eventType}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDate(n.sentAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Top Engaged Users ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Top Engaged Users</CardTitle>
          <CardDescription>Users with most tips submitted</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">User</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Tips</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Last Tip</th>
                </tr>
              </thead>
              <tbody>
                {data.topTipUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No tips submitted yet
                    </td>
                  </tr>
                )}
                {data.topTipUsers.map((u, i) => (
                  <tr key={u.userId} className={`border-b border-border/30 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-2 font-medium">{u.username}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.tipCount}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{formatRelative(u.lastTip)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Discussion Activity ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Discussion Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-lg font-bold tabular-nums">{data.discussions.threadsTotal}</p>
              <p className="text-xs text-muted-foreground">Total threads</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{data.discussions.threadsLast7d}</p>
              <p className="text-xs text-muted-foreground">Threads (last 7d)</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{data.discussions.postsTotal}</p>
              <p className="text-xs text-muted-foreground">Total posts</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{data.discussions.postsLast7d}</p>
              <p className="text-xs text-muted-foreground">Posts (last 7d)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        Data as of {new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}
      </p>
    </div>
  );
}
