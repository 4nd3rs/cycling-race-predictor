import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { getAuthUser } from "@/lib/auth";
import { db, users, userFollows, userTelegram, riders, raceEvents, races, raceStartlist, teams } from "@/lib/db";
import { eq, and, gte, lt, lte, inArray, desc } from "drizzle-orm";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl } from "@/lib/url-utils";
import { ConnectTelegramButton } from "@/components/connect-telegram-button";
import { NotificationFrequencySelector } from "@/components/notification-frequency-selector";

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getPageData(userId: string) {
  const today = new Date().toISOString().split("T")[0];
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0];

  const [user] = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!user) return null;

  const [follows, telegramRows] = await Promise.all([
    db.select().from(userFollows).where(eq(userFollows.userId, user.id)),
    db.select().from(userTelegram).where(eq(userTelegram.userId, user.id)).limit(1),
  ]);

  const raceEventIds = follows.filter(f => f.followType === "race_event").map(f => f.entityId);
  const riderIds = follows.filter(f => f.followType === "rider").map(f => f.entityId);
  const teamIds = follows.filter(f => f.followType === "team").map(f => f.entityId);
  const raceCatIds = follows.filter(f => f.followType === "race").map(f => f.entityId);

  // Schedule data
  const [upcomingEvents, pastEvents, riderRaceRows, followedRiders, followedTeams] = await Promise.all([
    raceEventIds.length > 0
      ? db.selectDistinct({ event: raceEvents }).from(raceEvents)
          .where(and(inArray(raceEvents.id, raceEventIds), gte(raceEvents.date, today)))
          .orderBy(raceEvents.date).limit(30)
      : [],
    raceEventIds.length > 0
      ? db.selectDistinct({ event: raceEvents }).from(raceEvents)
          .where(and(inArray(raceEvents.id, raceEventIds), lt(raceEvents.date, today), gte(raceEvents.date, sixtyDaysAgo)))
          .orderBy(desc(raceEvents.date)).limit(10)
      : [],
    riderIds.length > 0
      ? db.select({
          rider: { id: riders.id, name: riders.name, photoUrl: riders.photoUrl },
          event: raceEvents,
        })
        .from(raceStartlist)
        .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
        .innerJoin(races, eq(raceStartlist.raceId, races.id))
        .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
        .where(and(inArray(raceStartlist.riderId, riderIds), gte(raceEvents.date, today), lte(raceEvents.date, sixtyDaysAhead)))
        .orderBy(raceEvents.date).limit(100)
      : [],
    riderIds.length > 0
      ? db.select({ id: riders.id, name: riders.name, photoUrl: riders.photoUrl, nationality: riders.nationality })
          .from(riders).where(inArray(riders.id, riderIds)).limit(50)
      : [],
    teamIds.length > 0
      ? db.select({ id: teams.id, name: teams.name, logoUrl: teams.logoUrl, country: teams.country, division: teams.division })
          .from(teams).where(inArray(teams.id, teamIds)).limit(30)
      : [],
  ]);

  // Group rider races
  const followedEventSet = new Set(raceEventIds);
  const riderEventMap = new Map<string, { event: typeof raceEvents.$inferSelect; riderNames: { id: string; name: string; photoUrl: string | null }[] }>();
  for (const { rider, event } of riderRaceRows) {
    if (followedEventSet.has(event.id)) continue;
    if (!riderEventMap.has(event.id)) riderEventMap.set(event.id, { event, riderNames: [] });
    const e = riderEventMap.get(event.id)!;
    if (!e.riderNames.find(r => r.id === rider.id)) e.riderNames.push(rider);
  }
  const riderRaces = Array.from(riderEventMap.values()).sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime());

  // Following data
  const [riderDetails, raceEventDetails, raceCatDetails] = await Promise.all([
    riderIds.length > 0
      ? db.select({ id: riders.id, name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
          .from(riders).where(inArray(riders.id, riderIds)).limit(50)
      : [],
    raceEventIds.length > 0
      ? db.select({ id: raceEvents.id, name: raceEvents.name, discipline: raceEvents.discipline, date: raceEvents.date, slug: raceEvents.slug })
          .from(raceEvents).where(inArray(raceEvents.id, raceEventIds)).limit(30)
      : [],
    raceCatIds.length > 0
      ? db.select({
          id: races.id, gender: races.gender, ageCategory: races.ageCategory,
          discipline: races.discipline, categorySlug: races.categorySlug,
          eventId: races.raceEventId,
          eventName: raceEvents.name, eventSlug: raceEvents.slug, eventDate: raceEvents.date,
        })
        .from(races)
        .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
        .where(inArray(races.id, raceCatIds)).limit(30)
      : [],
  ]);

  return {
    user,
    telegram: telegramRows[0] || null,
    // schedule
    upcomingEvents: upcomingEvents.map(r => r.event),
    pastEvents: pastEvents.map(r => r.event),
    riderRaces,
    // following
    riderDetails,
    raceEventDetails,
    raceCatDetails,
    followedRiders,
    followedTeams,
    // counts
    riderCount: riderIds.length,
    eventCount: raceEventIds.length,
    teamCount: teamIds.length,
  };
}

// ── Helper components ─────────────────────────────────────────────────────────

function EventRow({ event, riderList }: {
  event: typeof raceEvents.$inferSelect;
  riderList?: { id: string; name: string; photoUrl: string | null }[];
}) {
  const start = new Date(event.date + "T12:00:00");
  const done = isPast(new Date((event.endDate ?? event.date).toString().split("T")[0] + "T23:59:59Z"));
  const live = isToday(new Date(String(start instanceof Date ? start.toISOString().split("T")[0] : String(start).split("T")[0]) + "T12:00:00Z"));
  const url = event.slug ? buildEventUrl(event.discipline, event.slug) : `/races/${event.id}`;
  return (
    <div className={"flex items-center gap-3 py-3 px-4 border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" + (live ? " bg-red-500/5 border-l-2 border-l-red-500" : "")}>
      <span className="w-16 shrink-0 text-xs font-mono text-muted-foreground">{format(start, "MMM d")}</span>
      {event.country && <span className="text-base shrink-0">{getFlag(event.country)}</span>}
      <Link href={url} className="flex-1 min-w-0 text-sm font-medium truncate hover:text-primary transition-colors">{event.name}</Link>
      {riderList && riderList.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {riderList.slice(0, 3).map(r => {
            const initials = r.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            return r.photoUrl
              ? <img key={r.id} src={r.photoUrl} alt={r.name} title={r.name} className="h-5 w-5 rounded-full object-cover" />
              : <span key={r.id} title={r.name} className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold">{initials}</span>;
          })}
          {riderList.length > 3 && <span className="text-[10px] text-muted-foreground">+{riderList.length - 3}</span>}
        </div>
      )}
      <span className={"shrink-0 text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap " + (live ? "bg-red-500 text-white animate-pulse" : done ? "text-muted-foreground bg-muted/30" : "text-green-400 bg-green-500/10 border border-green-500/20")}>
        {live ? "LIVE" : done ? "Done" : formatDistanceToNow(start, { addSuffix: true })}
      </span>
    </div>
  );
}

function SectionBox({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
      <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/5">
        {children}
        {empty && <p className="px-4 py-6 text-sm text-muted-foreground text-center">{empty}</p>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function MyRaceHubPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Ensure user exists in our DB (creates on first login with new Clerk instance)
  await getAuthUser();


  const data = await getPageData(userId);
  if (!data) redirect("/sign-in");

  const { tab = "schedule" } = await searchParams;
  const activeTab = ["schedule", "following", "notifications", "feed"].includes(tab) ? tab : "schedule";

  // Fetch notification feed
  const feedItems = await import("@neondatabase/serverless").then(async ({ neon }) => {
    const sql = neon(process.env.DATABASE_URL!);
    return sql`
      SELECT nl.message_type, nl.sent_at, nl.message_text,
             re.name as event_name, re.slug as event_slug, re.discipline
      FROM notification_log nl
      LEFT JOIN races r ON r.id = nl.race_id
      LEFT JOIN race_events re ON re.id = r.race_event_id
      WHERE nl.user_id = ${data.user.id}
        AND nl.message_text IS NOT NULL
        AND nl.channel = 'telegram'
      ORDER BY nl.sent_at DESC
      LIMIT 30
    `;
  }).catch(() => []);

  const { user } = data;
  const initials = (user.name || user.email || "U").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  const tabs = [
    { id: "schedule", label: "Schedule" },
    { id: "following", label: "Following" },
    { id: "feed", label: "My Feed" },
    { id: "notifications", label: "Notifications" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl py-8">

        {/* User header */}
        <div className="flex items-start gap-4 mb-8">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name || "Avatar"} className="w-14 h-14 rounded-full border border-border/50 shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary shrink-0">{initials}</div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight">My Race Hub</h1>
              <Badge variant="outline" className="capitalize">{user.tier}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{user.name || user.email}</p>
            {/* Channel status */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Link href="?tab=notifications" className={"inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors " + (data.telegram?.connectedAt ? "bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25" : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50")}>
                <span className={"w-1.5 h-1.5 rounded-full " + (data.telegram?.connectedAt ? "bg-blue-400" : "bg-muted-foreground/40")}></span>
                {data.telegram?.connectedAt ? "Telegram" : "Connect Telegram"}
              </Link>
              <Link href="?tab=notifications" className={"inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors " + ("bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50")>
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"></span>
                Connect Telegram
              </Link>
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mb-8 p-1 rounded-full bg-muted/20 border border-border/30 w-fit">
          {tabs.map(t => (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              className={"px-5 py-2 rounded-full text-sm font-medium transition-all " + (
                activeTab === t.id ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* ── SCHEDULE TAB ─────────────────────────────────────────────── */}
        {activeTab === "schedule" && (
          <div className="space-y-10">
            <SectionBox title="Upcoming races" empty={data.upcomingEvents.length === 0 ? undefined : undefined}>
              {data.upcomingEvents.length > 0
                ? data.upcomingEvents.map(e => <EventRow key={e.id} event={e} />)
                : <p className="px-4 py-6 text-sm text-muted-foreground text-center">No upcoming followed races. <Link href="/races" className="text-primary hover:underline">Browse races</Link></p>
              }
            </SectionBox>

            {data.riderRaces.length > 0 && (
              <SectionBox title="Where your riders are racing">
                {data.riderRaces.map(({ event, riderNames }) => <EventRow key={event.id} event={event} riderList={riderNames} />)}
              </SectionBox>
            )}

            {data.pastEvents.length > 0 && (
              <SectionBox title="Recent results">
                {data.pastEvents.map(e => <EventRow key={e.id} event={e} />)}
              </SectionBox>
            )}

            {data.eventCount === 0 && data.riderCount === 0 && data.teamCount === 0 && (
              <div className="text-center py-16">
                <p className="text-muted-foreground mb-4">You haven&apos;t followed any races or riders yet.</p>
                <div className="flex gap-3 justify-center">
                  <Link href="/riders" className="text-sm text-primary hover:underline">Browse riders</Link>
                  <Link href="/races" className="text-sm text-primary hover:underline">Browse races</Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FOLLOWING TAB ─────────────────────────────────────────────── */}
        {activeTab === "following" && (
          <div className="space-y-8">
            {/* Riders */}
            <section>
              <h2 className="text-base font-semibold mb-3">Followed Riders</h2>
              {data.riderDetails.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.riderDetails.map(rider => (
                    <Link key={rider.id} href={`/riders/${rider.id}`} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                      {rider.photoUrl ? (
                        <img src={rider.photoUrl} alt={rider.name} className="w-10 h-10 rounded-full object-cover object-top border border-border/30" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">{rider.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{rider.name}</p>
                        {rider.nationality && <p className="text-xs text-muted-foreground">{getFlag(rider.nationality)} {rider.nationality}</p>}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">No followed riders. <Link href="/riders" className="text-primary hover:underline">Browse riders</Link></p>}
            </section>

            {/* Race events */}
            <section>
              <h2 className="text-base font-semibold mb-3">Followed Races</h2>
              {data.raceEventDetails.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.raceEventDetails.map(event => (
                    <Link key={event.id} href={`/races/${event.discipline}/${event.slug}`} className="flex flex-col rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                      <p className="text-sm font-medium truncate">{event.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span className="capitalize">{event.discipline}</span>
                        <span>{event.date}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">No followed races. <Link href="/races" className="text-primary hover:underline">Browse races</Link></p>}
            </section>

            {/* Race categories */}
            {data.raceCatDetails.length > 0 && (
              <section>
                <h2 className="text-base font-semibold mb-3">Followed Race Categories</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.raceCatDetails.map(rc => {
                    const g = rc.gender === "men" ? "M" : "F";
                    const age = rc.ageCategory === "elite" ? "" : rc.ageCategory === "u23" ? " U23" : rc.ageCategory === "junior" ? " Junior" : ` ${rc.ageCategory}`;
                    const url = rc.eventSlug && rc.categorySlug ? `/races/${rc.discipline}/${rc.eventSlug}/${rc.categorySlug}` : `/races/${rc.discipline}/${rc.eventSlug}`;
                    return (
                      <Link key={rc.id} href={url} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                        <span className="text-xs font-bold bg-primary/20 text-primary rounded px-2 py-0.5 shrink-0">{g}{age}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{rc.eventName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{rc.eventDate}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Teams */}
            <section>
              <h2 className="text-base font-semibold mb-3">Followed Teams</h2>
              {data.followedTeams.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.followedTeams.map(team => (
                    <Link key={team.id} href={`/teams/${team.id}`} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                      {team.logoUrl ? <img src={team.logoUrl} alt={team.name} className="h-8 w-8 object-contain shrink-0" /> : <span className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{team.name.slice(0, 2).toUpperCase()}</span>}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{team.name}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          {team.country && <span>{getFlag(team.country)}</span>}
                          {team.division && <span className="font-mono">{team.division}</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">No followed teams. <Link href="/teams" className="text-primary hover:underline">Browse teams</Link></p>}
            </section>
          </div>
        )}

        {/* ── NOTIFICATIONS TAB ─────────────────────────────────────────── */}
        {activeTab === "feed" && (
          <div className="space-y-4 max-w-2xl">
            {feedItems.length === 0 ? (
              <div className="rounded-xl border border-border/50 bg-card/20 p-8 text-center">
                <p className="text-muted-foreground text-sm">No messages yet. Connect Telegram and follow some riders to get started.</p>
              </div>
            ) : (
              feedItems.map((item: any, i: number) => {
                const typeLabel: Record<string, string> = {
                  preview: "Race Preview",
                  raceday: "Race Day",
                  breaking: "Breaking",
                  result: "Result",
                };
                const date = new Date(item.sent_at);
                const text = (item.message_text as string)
                  .replace(/https?:\/\/\S+/g, "")
                  .trim();
                return (
                  <div key={i} className="rounded-xl border border-border/50 bg-card/30 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#C8102E]">
                        {typeLabel[item.message_type] || item.message_type}
                      </span>
                      {item.event_name && (
                        <>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span className="text-xs text-muted-foreground">{item.event_name}</span>
                        </>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{text}</p>
                    {item.event_slug && (
                      <Link
                        href={`/races/${item.discipline}/${item.event_slug}`}
                        className="inline-block mt-3 text-xs text-[#C8102E] hover:underline font-medium"
                      >
                        View race →
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="space-y-8 max-w-xl">
            {/* Channels */}
            <section>
              <h2 className="text-base font-semibold mb-1">Notification Channels</h2>
              <p className="text-sm text-muted-foreground mb-4">Connect a channel to receive updates for races, riders and teams you follow.</p>
              <div className="space-y-3">
                <div className="rounded-lg border border-border/50 bg-card/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">Telegram</p>
                      <p className="text-xs text-muted-foreground">Real-time alerts via @AMALabsBot</p>
                    </div>
                    {data.telegram?.connectedAt && <span className="text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">Connected</span>}
                  </div>
                  <ConnectTelegramButton connected={!!data.telegram?.connectedAt} />
                </div>
                <div className="rounded-lg border border-border/50 bg-card/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>

                </div>
              </div>
            </section>

            {/* Frequency */}
            <section>
              <h2 className="text-base font-semibold mb-1">Update Frequency</h2>
              <p className="text-sm text-muted-foreground mb-4">Choose how often you want to hear from us about races, results, and riders you follow.</p>
              <NotificationFrequencySelector currentFrequency={user.notificationFrequency ?? "daily"} />
            </section>
          </div>
        )}

      </main>
    </div>
  );
}
