import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db, users, userFollows, raceEvents, races, raceStartlist, riders, raceResults } from "@/lib/db";
import { teams } from "@/lib/db";
import { eq, and, gte, lte, lt, inArray, desc } from "drizzle-orm";
import Link from "next/link";
import { Header } from "@/components/header";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl } from "@/lib/url-utils";

async function getScheduleData(clerkId: string) {
  const today = new Date().toISOString().split("T")[0];

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return null;

  const follows = await db.select().from(userFollows).where(eq(userFollows.userId, user.id));
  const raceEventIds = follows.filter(f => f.followType === "race_event").map(f => f.entityId);
  const riderIds = follows.filter(f => f.followType === "rider").map(f => f.entityId);

  // Upcoming followed events
  const upcomingEvents = raceEventIds.length > 0
    ? await db.selectDistinct({ event: raceEvents }).from(raceEvents)
        .where(and(inArray(raceEvents.id, raceEventIds), gte(raceEvents.date, today)))
        .orderBy(raceEvents.date).limit(30)
    : [];

  // Past followed events (last 60 days)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];
  const pastEvents = raceEventIds.length > 0
    ? await db.selectDistinct({ event: raceEvents }).from(raceEvents)
        .where(and(inArray(raceEvents.id, raceEventIds), lt(raceEvents.date, today), gte(raceEvents.date, sixtyDaysAgo)))
        .orderBy(desc(raceEvents.date)).limit(10)
    : [];

  // Individual race category follows (follow_type = "race")
  const raceFollowIds = follows.filter(f => f.followType === "race").map(f => f.entityId);
  const followedRaceCategories = raceFollowIds.length > 0
    ? await db.select({
        race: races,
        event: raceEvents,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(inArray(races.id, raceFollowIds), gte(raceEvents.date, today)))
      .orderBy(raceEvents.date).limit(20)
    : [];

  // Rider races (upcoming, next 60 days)
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0];
  const riderRaceRows = riderIds.length > 0
    ? await db.select({
        rider: { id: riders.id, name: riders.name, photoUrl: riders.photoUrl },
        event: raceEvents,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .innerJoin(races, eq(raceStartlist.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(inArray(raceStartlist.riderId, riderIds), gte(raceEvents.date, today), lte(raceEvents.date, sixtyDaysAhead)))
      .orderBy(raceEvents.date).limit(100)
    : [];

  // Group rider races by event, exclude already-followed events
  const followedEventSet = new Set(raceEventIds);
  const riderEventMap = new Map<string, { event: typeof raceEvents.$inferSelect; riderNames: { id: string; name: string; photoUrl: string | null }[] }>();
  for (const { rider, event } of riderRaceRows) {
    if (followedEventSet.has(event.id)) continue;
    if (!riderEventMap.has(event.id)) riderEventMap.set(event.id, { event, riderNames: [] });
    const e = riderEventMap.get(event.id)!;
    if (!e.riderNames.find(r => r.id === rider.id)) e.riderNames.push(rider);
  }
  const riderRaces = Array.from(riderEventMap.values()).sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime());

  const teamIds = follows.filter(f => f.followType === "team").map(f => f.entityId);
  const followedTeams = teamIds.length > 0
    ? await db.select({ id: teams.id, name: teams.name, logoUrl: teams.logoUrl, country: teams.country, division: teams.division })
        .from(teams).where(inArray(teams.id, teamIds)).limit(30)
    : [];

  const followedRiders = riderIds.length > 0
    ? await db.select({ id: riders.id, name: riders.name, photoUrl: riders.photoUrl, nationality: riders.nationality })
        .from(riders).where(inArray(riders.id, riderIds)).limit(50)
    : [];

  return { upcomingEvents: upcomingEvents.map(r => r.event), pastEvents: pastEvents.map(r => r.event), riderRaces, followedRiders, followedTeams, riderCount: riderIds.length, eventCount: raceEventIds.length, teamCount: teamIds.length };
}

function EventRow({ event, riders: riderList }: {
  event: typeof raceEvents.$inferSelect;
  riders?: { id: string; name: string; photoUrl: string | null }[];
}) {
  const start = new Date(event.date + "T12:00:00");
  const done = isPast(new Date((event.endDate ?? event.date) + "T23:59:59"));
  const live = isToday(start);
  const url = event.slug ? buildEventUrl(event.discipline, event.slug) : `/races/${event.id}`;
  return (
    <div className={`flex items-center gap-3 py-3 px-4 border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors ${live ? "bg-red-500/5 border-l-2 border-l-red-500" : ""}`}>
      <span className="w-16 shrink-0 text-xs font-mono text-muted-foreground">{format(start, "MMM d")}</span>
      {event.country && <span className="text-base shrink-0">{getFlag(event.country)}</span>}
      <Link href={url} className="flex-1 min-w-0 text-sm font-medium truncate hover:text-primary transition-colors">
        {event.name}
      </Link>
      {riderList && riderList.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {riderList.slice(0, 3).map(r => {
            const initials = r.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            return r.photoUrl ? (
              <img key={r.id} src={r.photoUrl} alt={r.name} title={r.name} className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <span key={r.id} title={r.name} className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold">{initials}</span>
            );
          })}
          {riderList.length > 3 && <span className="text-[10px] text-muted-foreground">+{riderList.length - 3}</span>}
        </div>
      )}
      <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${live ? "bg-red-500 text-white animate-pulse" : done ? "text-muted-foreground bg-muted/30" : "text-green-400 bg-green-500/10 border border-green-500/20"}`}>
        {live ? "LIVE" : done ? "Done" : formatDistanceToNow(start, { addSuffix: true })}
      </span>
    </div>
  );
}

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) {
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

export default async function MySchedulePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const data = await getScheduleData(userId);
  if (!data) redirect("/sign-in");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">My Schedule</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {data.eventCount} followed {data.eventCount === 1 ? "race" : "races"} · {data.riderCount} followed {data.riderCount === 1 ? "rider" : "riders"}{data.teamCount > 0 ? ` · ${data.teamCount} followed ${data.teamCount === 1 ? "team" : "teams"}` : ""}
          </p>
        </div>

        <div className="space-y-10">
          {/* Upcoming */}
          <Section title="Upcoming races">
            {data.upcomingEvents.length > 0
              ? data.upcomingEvents.map(e => <EventRow key={e.id} event={e} />)
              : undefined}
            {data.upcomingEvents.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                No upcoming followed races. <Link href="/races" className="text-primary hover:underline">Browse races</Link>
              </p>
            )}
          </Section>

          {/* Rider races */}
          {data.riderRaces.length > 0 && (
            <Section title="Where your riders are racing">
              {data.riderRaces.map(({ event, riderNames }) => (
                <EventRow key={event.id} event={event} riders={riderNames} />
              ))}
            </Section>
          )}

          {/* Past results */}
          {data.pastEvents.length > 0 && (
            <Section title="Recent results">
              {data.pastEvents.map(e => <EventRow key={e.id} event={e} />)}
            </Section>
          )}

          {/* Followed riders */}
          {data.followedRiders.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Followed riders</h2>
              <div className="flex flex-wrap gap-2">
                {data.followedRiders.map(r => (
                  <Link key={r.id} href={`/riders/${r.id}`} className="flex items-center gap-2 rounded-full border border-border/40 px-3 py-1.5 text-sm hover:bg-muted/20 transition-colors">
                    {r.photoUrl ? (
                      <img src={r.photoUrl} alt={r.name} className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                        {r.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span>{r.name}</span>
                    {r.nationality && <span className="text-base">{getFlag(r.nationality)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Followed teams */}
          {data.followedTeams.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Followed teams</h2>
              <div className="flex flex-wrap gap-2">
                {data.followedTeams.map(t => (
                  <Link key={t.id} href={`/teams/${t.id}`} className="flex items-center gap-2 rounded-full border border-border/40 px-3 py-1.5 text-sm hover:bg-muted/20 transition-colors">
                    {t.logoUrl ? (
                      <img src={t.logoUrl} alt={t.name} className="h-5 w-5 object-contain" />
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold">
                        {t.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate max-w-[180px]">{t.name}</span>
                    {t.country && <span className="text-base">{getFlag(t.country)}</span>}
                    {t.division && <span className="text-[10px] text-muted-foreground font-mono">{t.division}</span>}
                  </Link>
                ))}
              </div>
            </div>
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
      </main>
    </div>
  );
}
