import { auth } from "@clerk/nextjs/server";
import { db, users, userFollows, raceEvents, races, raceStartlist, riders } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl } from "@/lib/url-utils";
import { getDisciplineShortLabel } from "@/lib/url-utils";

// ── Data fetching ──────────────────────────────────────────────────────────────

async function getMyFeed(clerkId: string) {
  const today = new Date().toISOString().split("T")[0];

  // Get internal user
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return null;

  // Get all follows
  const follows = await db.select().from(userFollows).where(eq(userFollows.userId, user.id));
  const raceEventFollowIds = follows.filter(f => f.followType === "race_event").map(f => f.entityId);
  const raceFollowIds = follows.filter(f => f.followType === "race").map(f => f.entityId);
  const riderFollowIds = follows.filter(f => f.followType === "rider").map(f => f.entityId);

  if (raceEventFollowIds.length === 0 && raceFollowIds.length === 0 && riderFollowIds.length === 0) return { empty: true, events: [], riderRaces: [] };

  // 1a. Upcoming followed race_events
  const followedByEvent = raceEventFollowIds.length > 0
    ? await db
        .select({ event: raceEvents, race: races })
        .from(raceEvents)
        .innerJoin(races, eq(races.raceEventId, raceEvents.id))
        .where(and(inArray(raceEvents.id, raceEventFollowIds), gte(raceEvents.date, today)))
        .orderBy(raceEvents.date)
        .limit(20)
    : [];

  // 1b. Upcoming events from followed individual races (followType="race")
  const followedByRace = raceFollowIds.length > 0
    ? await db
        .select({ event: raceEvents, race: races })
        .from(races)
        .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
        .where(and(inArray(races.id, raceFollowIds), gte(raceEvents.date, today)))
        .orderBy(raceEvents.date)
        .limit(20)
    : [];

  // Merge both sets
  const followedEvents = [...followedByEvent, ...followedByRace];

  // Deduplicate events (multiple categories per event)
  const eventMap = new Map<string, typeof followedEvents[0]["event"] & { categories: string[] }>();
  for (const { event, race } of followedEvents) {
    if (!eventMap.has(event.id)) {
      eventMap.set(event.id, { ...event, categories: [] });
    }
    const cat = `${race.gender === "men" ? "M" : "F"}`;
    if (!eventMap.get(event.id)!.categories.includes(cat)) {
      eventMap.get(event.id)!.categories.push(cat);
    }
  }
  const upcomingFollowedEvents = Array.from(eventMap.values()).slice(0, 3);

  // 2. Upcoming races where followed riders are in startlist
  const riderRaceRows = riderFollowIds.length > 0
    ? await db
        .select({
          rider: { id: riders.id, name: riders.name, photoUrl: riders.photoUrl, nationality: riders.nationality },
          race: races,
          event: raceEvents,
        })
        .from(raceStartlist)
        .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
        .innerJoin(races, eq(raceStartlist.raceId, races.id))
        .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
        .where(and(inArray(raceStartlist.riderId, riderFollowIds), gte(raceEvents.date, today)))
        .orderBy(raceEvents.date)
        .limit(50)
    : [];

  // Group: event → riders
  const riderEventMap = new Map<string, {
    event: typeof raceEvents.$inferSelect;
    riderNames: { id: string; name: string; photoUrl: string | null; nationality: string | null }[];
  }>();
  for (const { rider, event } of riderRaceRows) {
    if (!riderEventMap.has(event.id)) {
      riderEventMap.set(event.id, { event, riderNames: [] });
    }
    const existing = riderEventMap.get(event.id)!;
    if (!existing.riderNames.find(r => r.id === rider.id)) {
      existing.riderNames.push(rider);
    }
  }
  // Exclude events already in followed events
  const followedEventIds = new Set(upcomingFollowedEvents.map(e => e.id));
  const riderRaceList = Array.from(riderEventMap.values())
    .filter(r => !followedEventIds.has(r.event.id))
    .slice(0, 3);

  return { empty: false, events: upcomingFollowedEvents, riderRaces: riderRaceList };
}

// ── UI Helpers ─────────────────────────────────────────────────────────────────

function EventRow({ event, extra }: {
  event: typeof raceEvents.$inferSelect & { categories?: string[] };
  extra?: React.ReactNode;
}) {
  const start = new Date(event.date + "T12:00:00");
  const done = isPast(new Date((event.endDate ?? event.date).toString().split("T")[0] + "T23:59:59Z"));
  const url = event.slug ? buildEventUrl(event.discipline, event.slug) : `/races/${event.id}`;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 group">
      <span className="w-14 shrink-0 text-xs text-muted-foreground font-mono tabular-nums">
        {format(start, "MMM d")}
      </span>
      {event.country && (
        <span className="text-base shrink-0 leading-none">{getFlag(event.country)}</span>
      )}
      <Link href={url} className="flex-1 min-w-0 text-sm font-medium truncate hover:text-primary transition-colors">
        {event.name}
      </Link>
      {extra && <div className="shrink-0 flex items-center gap-1">{extra}</div>}
      <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${done ? "text-muted-foreground bg-muted/30" : "text-green-400 bg-green-500/10 border border-green-500/20"}`}>
        {done ? "Done" : formatDistanceToNow(start, { addSuffix: true })}
      </span>
    </div>
  );
}

function RiderChip({ name, photoUrl, nationality }: { name: string; photoUrl: string | null; nationality: string | null }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex items-center gap-1 bg-muted/40 rounded-full px-2 py-0.5 text-xs text-muted-foreground">
      {photoUrl ? (
        <img src={photoUrl} alt={name} className="h-4 w-4 rounded-full object-cover" />
      ) : (
        <span className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold">{initials}</span>
      )}
      <span className="truncate max-w-[80px]">{name.split(" ").at(-1)}</span>
    </span>
  );
}

// ── Widget ──────────────────────────────────────────────────────────────────────

export async function MyFeedWidget() {
  const { userId } = await auth();
  if (!userId) return null;

  const feed = await getMyFeed(userId);
  if (!feed) return null;
  if (feed.empty) {
    return (
      <section className="border-b border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">
          <h2 className="text-base font-semibold mb-2">My Feed</h2>
          <p className="text-sm text-muted-foreground">
            Follow riders and races to see personalized updates here.{" "}
            <Link href="/riders" className="text-primary hover:underline">Browse riders</Link>{" "}
            or{" "}
            <Link href="/races" className="text-primary hover:underline">races</Link>.
          </p>
        </div>
      </section>
    );
  }

  const total = feed.events.length + feed.riderRaces.length;
  if (total === 0) return null;

  // Merge and take top 3 closest events
  const allItems = [
    ...feed.events.map(e => ({ type: "event" as const, event: e, riderNames: [] as typeof feed.riderRaces[0]["riderNames"] })),
    ...feed.riderRaces.map(r => ({ type: "rider" as const, ...r })),
  ].sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime()).slice(0, 3);

  if (allItems.length === 0) return null;

  return (
    <section className="border-b border-border/50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">My Schedule</h2>
          <Link href="/my-schedule" className="text-xs text-primary hover:text-primary/80 transition-colors">
            Full schedule &amp; results →
          </Link>
        </div>

        <div className="rounded-lg border border-border/40 divide-y divide-border/20 overflow-hidden bg-muted/5">
          {allItems.map(({ event, riderNames }) => (
            <EventRow
              key={event.id}
              event={event}
              extra={riderNames.length > 0 ? (
                <div className="flex items-center gap-1">
                  {riderNames.slice(0, 2).map(r => (
                    <RiderChip key={r.id} name={r.name} photoUrl={r.photoUrl} nationality={r.nationality} />
                  ))}
                  {riderNames.length > 2 && (
                    <span className="text-[10px] text-muted-foreground">+{riderNames.length - 2}</span>
                  )}
                </div>
              ) : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
