import { Suspense } from "react";
import { isAdmin } from "@/lib/auth";
import { Header } from "@/components/header";
import { EventListView } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { db, races, raceEvents } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNull } from "drizzle-orm";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  VALID_DISCIPLINES,
  getDisciplineLabel,
  type Discipline,
} from "@/lib/url-utils";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GroupedEvent {
  id: string;
  name: string;
  slug: string | null;
  date: string;
  endDate: string | null;
  country: string | null;
  discipline: string;
  subDiscipline: string | null;
  series: string | null;
  uciCategory: string | null;   // most prestigious category for this event
  externalLinks: {
    website?: string; twitter?: string; instagram?: string; youtube?: string;
    liveStream?: Array<{ name: string; url: string; free?: boolean }>;
    tracking?: string;
  } | null;
  categories: Array<{
    id: string;
    ageCategory: string;
    gender: string;
    categorySlug: string | null;
    riderCount: number;
  }>;
}

// ─── Data fetching ────────────────────────────────────────────────────────────
async function getEvents(discipline: string | null, upcoming: boolean): Promise<GroupedEvent[]> {
  const today = new Date().toISOString().split("T")[0];

  try {
    const conditions = [
      upcoming ? gte(raceEvents.date, today) : lt(raceEvents.date, today),
      ...(discipline && discipline !== "all" ? [eq(raceEvents.discipline, discipline as Discipline)] : []),
    ];

    const eventRaces = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(...conditions))
      .orderBy(upcoming ? raceEvents.date : desc(raceEvents.date))
      .limit(300);

    // hype score for picking the "best" uciCategory per event
    const hype = (cat: string | null | undefined) => {
      const c = (cat || "").toUpperCase().trim();
      if (c === "WORLDTOUR" || c === "1.UWT") return 100;
      if (c === "WC") return 90;
      if (c === "1.PRO" || c === "2.PRO" || c === "PROSERIES") return 80;
      if (c === "C1") return 70;
      if (c === "1.1" || c === "2.1") return 50;
      return 30;
    };

    const eventsMap = new Map<string, GroupedEvent>();
    for (const { race, event, startlistCount, resultCount } of eventRaces) {
      if (!eventsMap.has(event.id)) {
        eventsMap.set(event.id, {
          id: event.id,
          name: event.name,
          slug: event.slug,
          date: event.date,
          endDate: event.endDate,
          country: event.country,
          discipline: event.discipline,
          subDiscipline: event.subDiscipline,
          series: event.series,
          uciCategory: race.uciCategory ?? null,
          externalLinks: (event.externalLinks as GroupedEvent["externalLinks"]) ?? null,
          categories: [],
        });
      } else {
        // Keep the most prestigious uciCategory
        const existing = eventsMap.get(event.id)!;
        if (hype(race.uciCategory) > hype(existing.uciCategory)) {
          existing.uciCategory = race.uciCategory ?? null;
        }
      }
      const riderCount = Math.max(Number(startlistCount) || 0, Number(resultCount) || 0);
      eventsMap.get(event.id)!.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount,
      });
    }

    return Array.from(eventsMap.values()).sort((a, b) =>
      upcoming
        ? new Date(a.date).getTime() - new Date(b.date).getTime()
        : new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function getDisciplineCounts() {
  const today = new Date().toISOString().split("T")[0];
  const counts: Record<string, { upcoming: number; total: number }> = {};

  for (const d of VALID_DISCIPLINES) {
    try {
      const [uc, tc] = await Promise.all([
        db.select({ c: sql<number>`count(distinct ${raceEvents.id})` }).from(raceEvents)
          .where(and(eq(raceEvents.discipline, d), gte(raceEvents.date, today))),
        db.select({ c: sql<number>`count(distinct ${raceEvents.id})` }).from(raceEvents)
          .where(eq(raceEvents.discipline, d)),
      ]);
      counts[d] = { upcoming: Number(uc[0]?.c) || 0, total: Number(tc[0]?.c) || 0 };
    } catch {
      counts[d] = { upcoming: 0, total: 0 };
    }
  }
  return counts;
}

// ─── Discipline filter bar ─────────────────────────────────────────────────────
const DISC_META: Record<string, { emoji: string; color: string; active: string }> = {
  all:        { emoji: "🌐", color: "border-border/50 text-muted-foreground hover:border-border hover:text-foreground", active: "border-foreground text-foreground bg-muted/40" },
  mtb:        { emoji: "🚵", color: "border-emerald-500/30 text-emerald-400 hover:border-emerald-500 hover:bg-emerald-500/10", active: "border-emerald-500 bg-emerald-500/15 text-emerald-300" },
  road:       { emoji: "🚴", color: "border-red-500/30 text-red-400 hover:border-red-500 hover:bg-red-500/10", active: "border-red-500 bg-red-500/15 text-red-300" },
  gravel:     { emoji: "🏔️", color: "border-amber-500/30 text-amber-400 hover:border-amber-500 hover:bg-amber-500/10", active: "border-amber-500 bg-amber-500/15 text-amber-300" },
  cyclocross: { emoji: "🔄", color: "border-purple-500/30 text-purple-400 hover:border-purple-500 hover:bg-purple-500/10", active: "border-purple-500 bg-purple-500/15 text-purple-300" },
};

function DisciplineFilter({
  active,
  tab,
  counts,
}: {
  active: string;
  tab: string;
  counts: Record<string, { upcoming: number; total: number }>;
}) {
  const items = [
    { key: "all",        label: "All" },
    { key: "mtb",        label: "MTB" },
    { key: "road",       label: "Road" },
    { key: "gravel",     label: "Gravel" },
    { key: "cyclocross", label: "CX" },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {items.map(({ key, label }) => {
        const meta = DISC_META[key];
        const isActive = active === key;
        const cnt = key === "all"
          ? Object.values(counts).reduce((s, c) => s + (tab === "upcoming" ? c.upcoming : c.total), 0)
          : tab === "upcoming"
            ? counts[key]?.upcoming ?? 0
            : counts[key]?.total ?? 0;

        return (
          <Link
            key={key}
            href={`/races?d=${key}&tab=${tab}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-all",
              isActive ? meta.active : meta.color
            )}
          >
            <span>{meta.emoji}</span>
            <span>{label}</span>
            <span className="text-xs opacity-70 tabular-nums">({cnt})</span>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Tab links ─────────────────────────────────────────────────────────────────
function TabLinks({ activeTab, discipline }: { activeTab: string; discipline: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
      {["upcoming", "recent"].map((t) => (
        <Link
          key={t}
          href={`/races?tab=${t}&d=${discipline}`}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors capitalize",
            activeTab === t
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t === "upcoming" ? "Upcoming" : "Recent"}
        </Link>
      ))}
    </div>
  );
}

// ─── Event section ─────────────────────────────────────────────────────────────
async function EventsSection({ discipline, tab }: { discipline: string; tab: string }) {
  const events = await getEvents(discipline === "all" ? null : discipline, tab === "upcoming");

  const label = discipline === "all" ? "all disciplines" : getDisciplineLabel(discipline as Discipline);
  const emptyMsg = tab === "upcoming"
    ? `No upcoming ${label} events found.`
    : `No recent ${label} events found.`;

  return (
    <EventListView
      events={events}
      emptyMessage={emptyMsg}
    />
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3 px-3 border-b border-border/30">
          <div className="w-12 h-4 rounded bg-muted animate-pulse" />
          <div className="w-14 h-4 rounded bg-muted animate-pulse" />
          <div className="flex-1 h-4 rounded bg-muted animate-pulse" />
          <div className="w-16 h-4 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
interface PageProps {
  searchParams: Promise<{ d?: string; tab?: string }>;
}

export default async function RacesPage({ searchParams }: PageProps) {
  const admin = await isAdmin();
  const { d, tab: tabParam } = await searchParams;

  const discipline = VALID_DISCIPLINES.includes(d as Discipline) ? (d as string) : "all";
  const tab = tabParam === "recent" ? "recent" : "upcoming";

  const counts = await getDisciplineCounts();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">

        {/* ── Page header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Races</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {discipline === "all"
                ? "All cycling events — MTB, Road, Gravel, CX"
                : `${getDisciplineLabel(discipline as Discipline)} events`}
            </p>
          </div>
          {admin && (
            <Button asChild size="sm">
              <Link href="/races/new">+ Add Race</Link>
            </Button>
          )}
        </div>

        {/* ── Discipline filter ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <DisciplineFilter active={discipline} tab={tab} counts={counts} />
          <TabLinks activeTab={tab} discipline={discipline} />
        </div>

        {/* ── Event list ── */}
        <Suspense fallback={<ListSkeleton />}>
          <EventsSection discipline={discipline} tab={tab} />
        </Suspense>

      </main>
    </div>
  );
}
