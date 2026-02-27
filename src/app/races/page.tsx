import { Suspense } from "react";
import { Header } from "@/components/header";
import { EventListView } from "@/components/event-card";
import { RaceFilters } from "@/components/race-filters";
import { db, races, raceEvents } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, inArray } from "drizzle-orm";
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
  uciCategory: string | null;
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

// ─── Country name helper ──────────────────────────────────────────────────────
function getCountryName(code: string): string {
  const map: Record<string, string> = {
    BEL: "Belgium", ITA: "Italy", FRA: "France", ESP: "Spain", GER: "Germany",
    NED: "Netherlands", GBR: "Great Britain", SUI: "Switzerland", AUT: "Austria",
    DEN: "Denmark", NOR: "Norway", SWE: "Sweden", FIN: "Finland", POL: "Poland",
    CZE: "Czech Republic", SVK: "Slovakia", HUN: "Hungary", POR: "Portugal",
    USA: "United States", CAN: "Canada", MEX: "Mexico", BRA: "Brazil",
    ARG: "Argentina", COL: "Colombia", CHI: "Chile", ECU: "Ecuador",
    AUS: "Australia", NZL: "New Zealand", JPN: "Japan", CHN: "China",
    KOR: "South Korea", RSA: "South Africa", MAR: "Morocco", AND: "Andorra",
    LUX: "Luxembourg", IRL: "Ireland", GRE: "Greece", TUR: "Turkey",
    UKR: "Ukraine", SLO: "Slovenia", CRO: "Croatia", SRB: "Serbia",
    ROU: "Romania", BUL: "Bulgaria", LAT: "Latvia", LTU: "Lithuania",
    EST: "Estonia", KAZ: "Kazakhstan", ERI: "Eritrea", RWA: "Rwanda",
    ETH: "Ethiopia", URU: "Uruguay", PER: "Peru",
  };
  return map[code] || code;
}

// ─── Data fetching ────────────────────────────────────────────────────────────
async function getEvents(
  discipline: string | null,
  upcoming: boolean,
  gender: string | null,
  country: string | null
): Promise<GroupedEvent[]> {
  const today = new Date().toISOString().split("T")[0];

  try {
    const conditions = [
      upcoming ? gte(raceEvents.date, today) : lt(raceEvents.date, today),
      ...(discipline && discipline !== "all" ? [eq(raceEvents.discipline, discipline as Discipline)] : []),
      ...(country ? [eq(raceEvents.country, country)] : []),
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
      // Gender filter: skip races that don't match
      if (gender && gender !== "all" && race.gender !== gender) continue;

      if (!eventsMap.has(event.id)) {
        eventsMap.set(event.id, {
          id: event.id, name: event.name, slug: event.slug, date: event.date,
          endDate: event.endDate, country: event.country, discipline: event.discipline,
          subDiscipline: event.subDiscipline, series: event.series,
          uciCategory: race.uciCategory ?? null,
          externalLinks: (event.externalLinks as GroupedEvent["externalLinks"]) ?? null,
          categories: [],
        });
      } else {
        const existing = eventsMap.get(event.id)!;
        if (hype(race.uciCategory) > hype(existing.uciCategory)) {
          existing.uciCategory = race.uciCategory ?? null;
        }
      }
      const riderCount = Math.max(Number(startlistCount) || 0, Number(resultCount) || 0);
      eventsMap.get(event.id)!.categories.push({
        id: race.id, ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men", categorySlug: race.categorySlug, riderCount,
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

async function getCountries(upcoming: boolean): Promise<Array<{ code: string; name: string }>> {
  const today = new Date().toISOString().split("T")[0];
  try {
    const rows = await db
      .selectDistinct({ country: raceEvents.country })
      .from(raceEvents)
      .where(and(
        upcoming ? gte(raceEvents.date, today) : lt(raceEvents.date, today),
        sql`${raceEvents.country} IS NOT NULL`
      ))
      .orderBy(raceEvents.country);

    return rows
      .filter(r => r.country)
      .map(r => ({ code: r.country!, name: getCountryName(r.country!) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ─── Tab links ─────────────────────────────────────────────────────────────────
function TabLinks({ activeTab, discipline, gender, country }: {
  activeTab: string; discipline: string; gender: string; country: string;
}) {
  const buildHref = (t: string) => {
    const params = new URLSearchParams();
    if (discipline && discipline !== "all") params.set("d", discipline);
    if (gender && gender !== "all") params.set("gender", gender);
    if (country) params.set("country", country);
    params.set("tab", t);
    return `/races?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
      {["upcoming", "recent"].map((t) => (
        <Link key={t} href={buildHref(t)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors capitalize",
            activeTab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t === "upcoming" ? "Upcoming" : "Recent"}
        </Link>
      ))}
    </div>
  );
}

// ─── Event section ─────────────────────────────────────────────────────────────
async function EventsSection({
  discipline, tab, gender, country
}: {
  discipline: string; tab: string; gender: string; country: string;
}) {
  const events = await getEvents(
    discipline === "all" ? null : discipline,
    tab === "upcoming",
    gender === "all" ? null : gender,
    country || null
  );

  const parts = [];
  if (discipline !== "all") parts.push(getDisciplineLabel(discipline as Discipline));
  if (gender !== "all") parts.push(gender === "men" ? "Men" : "Women");
  if (country) parts.push(getCountryName(country));
  const label = parts.length ? parts.join(" · ") : "all disciplines";

  const emptyMsg = tab === "upcoming"
    ? `No upcoming ${label} events found.`
    : `No recent ${label} events found.`;

  return <EventListView events={events} emptyMessage={emptyMsg} />;
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
  searchParams: Promise<{ d?: string; tab?: string; gender?: string; country?: string }>;
}

export default async function RacesPage({ searchParams }: PageProps) {
  const { d, tab: tabParam, gender: genderParam, country: countryParam } = await searchParams;

  const discipline = VALID_DISCIPLINES.includes(d as Discipline) ? (d as string) : "all";
  const tab = tabParam === "recent" ? "recent" : "upcoming";
  const gender = ["men", "women"].includes(genderParam || "") ? genderParam! : "all";
  const country = countryParam || "";

  const countries = await getCountries(tab === "upcoming");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">

        {/* ── Page header ── */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Races</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            UCI cycling events — Road, MTB, Gravel, CX
          </p>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <RaceFilters countries={countries} />
          <TabLinks activeTab={tab} discipline={discipline} gender={gender} country={country} />
        </div>

        {/* ── Event list ── */}
        <Suspense fallback={<ListSkeleton />}>
          <EventsSection discipline={discipline} tab={tab} gender={gender} country={country} />
        </Suspense>

      </main>
    </div>
  );
}
