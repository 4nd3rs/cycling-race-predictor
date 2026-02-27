import Link from "next/link";
import { Header } from "@/components/header";
import { IntelCard } from "@/components/intel-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, races, raceEvents, riderRumours, riders, raceResults } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull } from "drizzle-orm";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { toRaceDate, toDateStr } from "@/lib/utils";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl, buildRaceUrl, getDisciplineShortLabel } from "@/lib/url-utils";
import { RaceLinksSection } from "@/components/race-links";
import { EventListView } from "@/components/event-card";
import { MyFeedWidget } from "@/components/my-feed-widget";
import { RaceFilters } from "@/components/race-filters";
import { RaceFollowButton } from "@/components/race-follow-button";

// ---------------------------------------------------------------------------
// HYPE SCORING — only prestigious races on the homepage
// ---------------------------------------------------------------------------

function normalizeUciCategory(raw: string): string {
  const map: Record<string, string> = {
    "WorldTour": "WT", "1.Pro": "1.Pro", "WorldCup": "WC",
    "Continental Series": "CS", "HC": "HC", "C1": "C1", "C2": "C2",
    "CN": "CN", "WC": "WC", "CS": "CS", "1": "1.1", "2": "1.2", "3": "1.3",
  };
  return map[raw] ?? raw;
}

function getHypeScore(uciCategory: string | null | undefined): number {
  const cat = (uciCategory || "").toUpperCase().trim();
  if (cat === "WORLDTOUR" || cat === "1.UWT" || cat === "2.UWT") return 100;
  if (cat === "WC") return 90;
  if (cat === "1.PRO" || cat === "2.PRO" || cat === "PROSERIES") return 80;
  if (cat === "C1") return 70;
  if (cat === "1.1" || cat === "2.1") return 50;
  if (cat === "1.2" || cat === "2.2") return 35;
  if (cat === "C2") return 20;
  return 30;
}

const HOMEPAGE_HYPE_MIN = 70;

/** Shape used by EventListView and the hero */
interface HomepageEvent {
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
  hypeScore: number;
  externalLinks: {
    website?: string; twitter?: string; instagram?: string; youtube?: string;
    liveStream?: Array<{ name: string; url: string; free?: boolean }>;
    tracking?: string;
  } | null;
  categories: Array<{ id: string; ageCategory: string; gender: string; categorySlug: string | null; riderCount: number }>;
  totalRiders: number;
}

// ---------------------------------------------------------------------------
// DATA FETCHING
// ---------------------------------------------------------------------------

async function getHighHypeRaces(): Promise<{ hero: HomepageEvent | null; calendar: HomepageEvent[] }> {
  const today = new Date().toISOString().split("T")[0];
  try {
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(gte(raceEvents.date, today), eq(races.status, "active")))
      .orderBy(raceEvents.date)
      .limit(150);

    // Group by event id — deduplicate categories into one row per event
    const eventsMap = new Map<string, HomepageEvent>();
    for (const { race, event, startlistCount } of result) {
      const riders = Number(startlistCount) || 0;
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
          hypeScore: getHypeScore(race.uciCategory),
          externalLinks: (event.externalLinks as HomepageEvent["externalLinks"]) ?? null,
          categories: [],
          totalRiders: 0,
        });
      } else {
        const ev = eventsMap.get(event.id)!;
        if (getHypeScore(race.uciCategory) > ev.hypeScore) {
          ev.uciCategory = race.uciCategory ?? null;
          ev.hypeScore = getHypeScore(race.uciCategory);
        }
      }
      const ev = eventsMap.get(event.id)!;
      ev.totalRiders += riders;
      ev.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount: riders,
      });
    }

    const allGrouped = Array.from(eventsMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const highHype = allGrouped.filter(e => e.hypeScore >= HOMEPAGE_HYPE_MIN);
    const pool = highHype.length > 0 ? highHype : allGrouped;

    return { hero: pool[0] ?? null, calendar: pool.slice(1, 20) };
  } catch {
    return { hero: null, calendar: [] };
  }
}

async function getLatestIntel() {
  try {
    const result = await db
      .select({
        rumour: riderRumours,
        rider: { id: riders.id, name: riders.name, photoUrl: riders.photoUrl },
      })
      .from(riderRumours)
      .innerJoin(riders, eq(riderRumours.riderId, riders.id))
      .where(isNotNull(riderRumours.summary))
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(10);

    return result;
  } catch {
    return [];
  }
}

async function getRecentResults() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

  try {
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        winner: riders,
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(
        and(
          eq(raceResults.position, 1),
          gte(races.date, cutoff),
          lt(races.date, new Date().toISOString().split("T")[0])
        )
      )
      .orderBy(desc(races.date))
      .limit(8);

    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function getDisciplineColor(discipline: string) {
  switch (discipline) {
    case "road": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "mtb": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "cyclocross": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "gravel": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function getDisciplineLabel(discipline: string) {
  switch (discipline) {
    case "road": return "ROAD";
    case "mtb": return "MTB";
    case "cyclocross": return "CX";
    case "gravel": return "GRAVEL";
    default: return discipline.toUpperCase();
  }
}

function getRaceUrl(race: typeof races.$inferSelect, event: typeof raceEvents.$inferSelect) {
  return buildRaceUrl(race, event);
}


// ─── Country name helper (shared with races page) ─────────────────────────
function getCountryName(code: string): string {
  const map: Record<string, string> = {
    BEL:"Belgium",ITA:"Italy",FRA:"France",ESP:"Spain",GER:"Germany",NED:"Netherlands",
    GBR:"Great Britain",SUI:"Switzerland",CHE:"Switzerland",AUT:"Austria",DEN:"Denmark",
    NOR:"Norway",SWE:"Sweden",FIN:"Finland",POL:"Poland",CZE:"Czech Republic",
    POR:"Portugal",USA:"United States",CAN:"Canada",BRA:"Brazil",ARG:"Argentina",
    COL:"Colombia",AUS:"Australia",JPN:"Japan",KOR:"South Korea",RSA:"South Africa",
    AND:"Andorra",LUX:"Luxembourg",IRL:"Ireland",CHI:"Chile",ECU:"Ecuador",
  };
  return map[code] || code;
}

async function getFilteredCalendarEvents(
  discipline: string | null,
  gender: string | null,
  country: string | null,
  cat: string | null = null
) {
  const today = new Date().toISOString().split("T")[0];
  try {
    const conditions: Parameters<typeof and>[0][] = [gte(raceEvents.date, today)];
    if (discipline && discipline !== "all") conditions.push(eq(raceEvents.discipline, discipline as any));
    if (country) conditions.push(eq(raceEvents.country, country));

    const rows = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        resultCount: sql<number>`(SELECT COUNT(*) FROM race_results WHERE race_results.race_id = ${races.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(...conditions))
      .orderBy(raceEvents.date)
      .limit(200);

    const eventsMap = new Map<string, HomepageEvent>();
    for (const { race, event, startlistCount } of rows) {
      if (gender && gender !== "all" && race.gender !== gender) continue;
      if (cat && cat !== "all") {
        const [catAge, catGender] = cat.split("-");
        if ((race.ageCategory || "elite") !== catAge) continue;
        if ((race.gender || "men") !== catGender) continue;
      }
      if (!eventsMap.has(event.id)) {
        eventsMap.set(event.id, {
          id: event.id, name: event.name, slug: event.slug, date: event.date,
          endDate: event.endDate, country: event.country, discipline: event.discipline,
          subDiscipline: event.subDiscipline, series: event.series,
          uciCategory: race.uciCategory ?? null, hypeScore: getHypeScore(race.uciCategory),
          externalLinks: (event.externalLinks as HomepageEvent["externalLinks"]) ?? null,
          categories: [], totalRiders: 0,
        });
      }
      const riders = Number(startlistCount) || 0;
      const ev = eventsMap.get(event.id)!;
      ev.totalRiders += riders;
      ev.categories.push({ id: race.id, ageCategory: race.ageCategory || "elite", gender: race.gender || "men", categorySlug: race.categorySlug, riderCount: riders });
    }
    return Array.from(eventsMap.values()).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 30);
  } catch { return []; }
}

async function getUpcomingCountries() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const rows = await db.selectDistinct({ country: raceEvents.country }).from(raceEvents)
      .where(and(gte(raceEvents.date, today), sql`${raceEvents.country} IS NOT NULL`))
      .orderBy(raceEvents.country);
    return rows.filter(r => r.country).map(r => ({ code: r.country!, name: getCountryName(r.country!) })).sort((a,b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

interface HomePageProps {
  searchParams: Promise<{ d?: string; gender?: string; country?: string; cat?: string }>;
}

export default async function Home({ searchParams }: HomePageProps) {
  const { d, gender: genderParam, country: countryParam, cat: catParam } = await searchParams;
  const filterDiscipline = d && d !== "all" ? d : null;
  const filterGender = genderParam && genderParam !== "all" ? genderParam : null;
  const filterCountry = countryParam || null;
  const filterCat = catParam && catParam !== "all" ? catParam : null;
  const hasFilters = !!(filterDiscipline || filterGender || filterCountry || filterCat);

  const [{ hero: nextRace, calendar: highHypeRaces }, latestIntel, recentResults, filteredRaces, calendarCountries] = await Promise.all([
    getHighHypeRaces(),
    getLatestIntel(),
    getRecentResults(),
    hasFilters ? getFilteredCalendarEvents(filterDiscipline, filterGender, filterCountry, filterCat) : Promise.resolve([]),
    getUpcomingCountries(),
  ]);
  const upcomingRaces = hasFilters ? filteredRaces : highHypeRaces;

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Header />
      <main className="flex-1">
        {/* ---- NEXT RACE SPOTLIGHT ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 md:py-16">
            {nextRace ? (
              <NextRaceHero event={nextRace} />
            ) : (
              <div className="text-center py-12">
                <p className="text-xl text-muted-foreground">No upcoming races — check back soon</p>
              </div>
            )}
          </div>
        </section>

        {/* ---- MY FEED (logged in users) ---- */}
        <MyFeedWidget />

        {/* ---- UPCOMING RACES TABLE ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold tracking-tight">On the Calendar</h2>
              <Link href="/races" className="text-sm text-primary hover:text-primary/80 transition-colors">
                View all races &rarr;
              </Link>
            </div>
            <div className="mb-4">
              <RaceFilters countries={calendarCountries} basePath="/" />
            </div>
            {upcomingRaces.length > 0 ? (
              <EventListView events={upcomingRaces} />
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No races match your filters.</p>
            )}
          </div>
        </section>

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 overflow-hidden">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 overflow-hidden">
            {/* ---- LATEST INTEL ---- */}
            <div className="lg:col-span-3 min-w-0 overflow-hidden">
              <h2 className="text-xl font-bold tracking-tight mb-6">
                Latest Intel
              </h2>
              {latestIntel.length > 0 ? (
                <div className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/20">
                  {latestIntel.map(({ rumour, rider }) => (
                    <IntelCard
                      key={rumour.id}
                      riderId={rider.id}
                      riderName={rider.name}
                      photoUrl={rider.photoUrl}
                      summary={rumour.summary}
                      aggregateScore={rumour.aggregateScore}
                      tipCount={rumour.tipCount}
                      lastUpdated={rumour.lastUpdated}
                    />
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">No intel yet — check back after race season starts.</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ---- RECENT RESULTS ---- */}
            <div className="lg:col-span-2 min-w-0 overflow-hidden">
              <h2 className="text-xl font-bold tracking-tight mb-6">
                Latest Results
              </h2>
              {recentResults.length > 0 ? (
                <div className="space-y-2">
                  {recentResults.map(({ race, event, winner }) => (
                    <Link
                      key={race.id}
                      href={getRaceUrl(race, event)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-card transition-colors group"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-500 text-sm font-bold shrink-0">
                        1
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                          {event.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {winner.name} &middot; {format(toRaceDate(race.date), "MMM d")}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${getDisciplineColor(event.discipline)}`}>
                        {getDisciplineLabel(event.discipline)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground text-sm">No recent results to show.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

        {/* ── FOLLOW ON WHATSAPP ──────────────────────────────────────── */}
        <section className="border-t border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Get Predictions on WhatsApp</h2>
                <p className="text-sm text-muted-foreground mt-1">Follow our channels for race previews and results delivered straight to WhatsApp</p>
              </div>
            </div>
          </div>
        </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <p>
            Data from{" "}
            <a
              href="https://www.procyclingstats.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              ProCyclingStats
            </a>
          </p>
          <p>Built with Next.js, TrueSkill, and AI</p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

function NextRaceHero({ event: ev }: { event: HomepageEvent }) {
  const raceDate = toRaceDate(ev.date);
  const daysUntil = differenceInDays(raceDate, new Date());
  const url = ev.slug ? buildEventUrl(ev.discipline, ev.slug) : `/races/${ev.id}`;
  const subLabel = ev.subDiscipline ? getDisciplineShortLabel(ev.subDiscipline) : null;

  return (
    <div className="relative">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              Next Race
            </span>
            {daysUntil >= 0 && daysUntil <= 7 && (
              <Badge className="bg-accent text-accent-foreground text-xs font-bold">
                {daysUntil === 0 ? "TODAY" : daysUntil === 1 ? "TOMORROW" : `IN ${daysUntil} DAYS`}
              </Badge>
            )}
          </div>

          <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">
            <Link href={url} className="hover:text-primary transition-colors">
              {ev.name}
            </Link>
          </h1>

          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {getFlag(ev.country)} {format(raceDate, "EEEE, MMMM d")}
            </span>
            <Badge variant="outline" className={getDisciplineColor(ev.discipline)}>
              {getDisciplineLabel(ev.discipline)}{subLabel ? ` ${subLabel}` : ""}
            </Badge>
            {ev.uciCategory && (
              <Badge variant="outline" className="border-primary/50 text-primary font-mono font-semibold text-xs">{normalizeUciCategory(ev.uciCategory)}</Badge>
            )}
          </div>

          {ev.totalRiders > 0 && (
            <p className="text-sm text-muted-foreground">
              {ev.totalRiders} riders confirmed across {ev.categories.length} categories
            </p>
          )}

          {ev.externalLinks && Object.keys(ev.externalLinks).length > 0 && (
            <div className="pt-1">
              <RaceLinksSection links={ev.externalLinks} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 self-start md:self-end shrink-0">
          <RaceFollowButton
            eventId={ev.id}
            eventName={ev.name}
            categories={ev.categories}
            size="default"
            className="border-white/20 hover:border-white/40"
          />
          <Button asChild size="lg">
            <Link href={url}>View Predictions &rarr;</Link>
          </Button>
        </div>
      </div>

      <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full hidden md:block" />
    </div>
  );
}

// UpcomingRaceCard replaced by EventListView (table) on homepage
