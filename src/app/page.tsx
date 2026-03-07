import Link from "next/link";
import { Header } from "@/components/header";
import { IntelCard } from "@/components/intel-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, races, raceEvents, riderRumours, riders, raceResults, predictions } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull, asc } from "drizzle-orm";
import { format, formatDistanceToNow } from "date-fns";
import { toRaceDate, toDateStr, calendarDaysUntil, todayStr } from "@/lib/utils";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl, buildRaceUrl, getDisciplineShortLabel, normalizeUciCategory, getDisciplineColor } from "@/lib/url-utils";
import { EventListView } from "@/components/event-card";
import { MyFeedWidget } from "@/components/my-feed-widget";
import { DisciplineFilter, CalendarFilters } from "@/components/race-filters";
import { RaceFollowButton } from "@/components/race-follow-button";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";

// ---------------------------------------------------------------------------
// HYPE SCORING — only prestigious races on the homepage
// ---------------------------------------------------------------------------


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
  newsCount: number;
  heroImage: string | null;
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

/** Composite score for hero selection: prestige + news buzz + proximity */
function getBuzzScore(hypeScore: number, newsCount: number, daysUntil: number): number {
  const proximityBonus = Math.max(0, 10 - Math.max(0, daysUntil)); // 10 pts today, 3 pts for 7 days out
  return hypeScore + (newsCount * 2) + proximityBonus;
}

async function getHighHypeRaces(discipline?: string | null, gender?: string | null): Promise<{ hero: HomepageEvent | null; calendar: HomepageEvent[] }> {
  const today = todayStr();
  try {
    const conditions: Parameters<typeof and>[0][] = [gte(raceEvents.date, today), eq(races.status, "active")];
    if (discipline && discipline !== "all") conditions.push(eq(raceEvents.discipline, discipline as any));
    if (gender && gender !== "all") conditions.push(eq(races.gender, gender));
    const result = await db
      .select({
        race: races,
        event: raceEvents,
        startlistCount: sql<number>`(SELECT COUNT(*) FROM race_startlist WHERE race_startlist.race_id = ${races.id})`,
        newsCount: sql<number>`(SELECT COUNT(*) FROM race_news WHERE race_news.race_event_id = ${raceEvents.id})`,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(and(...conditions))
      .orderBy(raceEvents.date)
      .limit(150);

    // Group by event id — deduplicate categories into one row per event
    const eventsMap = new Map<string, HomepageEvent>();
    for (const { race, event, startlistCount, newsCount } of result) {
      const riderCount = Number(startlistCount) || 0;
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
          newsCount: Number(newsCount) || 0,
          heroImage: null,
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
      ev.totalRiders += riderCount;
      ev.categories.push({
        id: race.id,
        ageCategory: race.ageCategory || "elite",
        gender: race.gender || "men",
        categorySlug: race.categorySlug,
        riderCount,
      });
    }

    const allGrouped = Array.from(eventsMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const highHype = allGrouped.filter(e => e.hypeScore >= HOMEPAGE_HYPE_MIN);
    const pool = highHype.length > 0 ? highHype : allGrouped;

    // Pick hero by buzz score (hype + news + proximity), not just chronological order
    const now = new Date();
    const heroPool = pool.filter(e => {
      const d = calendarDaysUntil(e.date);
      return d >= 0 && d <= 7; // Only consider races in the next 7 days as potential hero
    });
    const fallbackPool = pool; // if nothing in 7 days, use soonest high-hype

    const scoredPool = (heroPool.length > 0 ? heroPool : fallbackPool).map(e => ({
      event: e,
      buzzScore: getBuzzScore(e.hypeScore, e.newsCount, calendarDaysUntil(e.date)),
    })).sort((a, b) => b.buzzScore - a.buzzScore);

    const hero = scoredPool[0]?.event ?? null;
    const calendar = pool.filter(e => e.id !== hero?.id).slice(0, 20);

    return { hero, calendar };
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
  const today = todayStr();
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
          lt(races.date, today)
        )
      )
      .orderBy(desc(races.date))
      .limit(8);

    return result;
  } catch {
    return [];
  }
}

/** Fetch top 5 predictions per elite race category for the hero event */
async function getHeroPredictions(event: HomepageEvent): Promise<Map<string, Array<{ name: string; winPct: number; photoUrl: string | null }>>> {
  const eliteCategories = event.categories.filter(c => c.ageCategory === "elite");
  if (eliteCategories.length === 0) return new Map();
  try {
    const results = await Promise.all(
      eliteCategories.map(async (cat) => {
        const rows = await db
          .select({ prediction: predictions, rider: riders })
          .from(predictions)
          .innerJoin(riders, eq(predictions.riderId, riders.id))
          .where(eq(predictions.raceId, cat.id))
          .orderBy(asc(predictions.predictedPosition))
          .limit(5);
        const seen = new Set<string>();
        return {
          gender: cat.gender,
          picks: rows.filter(r => { if (seen.has(r.rider.id)) return false; seen.add(r.rider.id); return true; })
            .map(r => ({
              name: r.rider.name,
              winPct: r.prediction.winProbability ? Number(r.prediction.winProbability) * 100 : 0,
              photoUrl: r.rider.photoUrl ?? null,
            })),
        };
      })
    );
    const map = new Map<string, Array<{ name: string; winPct: number; photoUrl: string | null }>>();
    for (const { gender, picks } of results) {
      if (picks.length > 0) map.set(gender, picks);
    }
    return map;
  } catch { return new Map(); }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

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


// ─── Country name helper (shared utility) ─────────────────────────────────
import { getCountryName } from "@/lib/country-names";
import { getRaceImage } from "@/lib/race-images";

async function getFilteredCalendarEvents(
  discipline: string | null,
  gender: string | null,
  country: string | null,
  cat: string | null = null
) {
  const today = todayStr();
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
          newsCount: 0, heroImage: null,
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
  const today = todayStr();
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
  const { userId } = await auth();
  const filterDiscipline = d && d !== "all" ? d : null;
  const filterGender = genderParam && genderParam !== "all" ? genderParam : null;
  const filterCountry = countryParam || null;
  const filterCat = catParam && catParam !== "all" ? catParam : null;
  const hasFilters = !!(filterDiscipline || filterGender || filterCountry || filterCat);

  const [{ hero: nextRace, calendar: highHypeRaces }, latestIntel, recentResults, filteredRaces, calendarCountries] = await Promise.all([
    getHighHypeRaces(filterDiscipline, filterGender),
    getLatestIntel(),
    getRecentResults(),
    hasFilters ? getFilteredCalendarEvents(filterDiscipline, filterGender, filterCountry, filterCat) : Promise.resolve([]),
    getUpcomingCountries(),
  ]);
  const upcomingRaces = hasFilters ? filteredRaces : highHypeRaces;
  const heroPredictions = nextRace ? await getHeroPredictions(nextRace) : new Map();

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Header />
      <main className="flex-1">
        {/* ---- TOP FILTER BAR ---- */}
        <div className="border-b border-border/20 bg-zinc-950/80 relative">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl h-10 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">Filter</span>
            <span className="w-px h-3 bg-border/50 shrink-0" />
            <DisciplineFilter basePath="/" />
            {!userId && (
              <SignInButton mode="modal">
                <button className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0 group">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary group-hover:scale-125 transition-transform" />
                  Sign in to personalise
                </button>
              </SignInButton>
            )}
          </div>
        </div>

        {/* ---- NEXT RACE SPOTLIGHT ---- */}
        {(() => {
          const raceImg = nextRace ? getRaceImage(nextRace.slug) : null;
          return (
            <section className="border-b border-border/50 relative overflow-hidden">
              {raceImg && (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${raceImg.src})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
                  {/* Photo credit */}
                  <a
                    href={raceImg.commonsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-2 right-3 z-20 text-[10px] text-white/40 hover:text-white/70 transition-colors"
                  >
                    Photo: {raceImg.credit} / {raceImg.license}
                  </a>
                </>
              )}
              <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 md:py-16">
                {nextRace ? (
                  <NextRaceHero event={nextRace} genderFilter={filterGender} heroPredictions={heroPredictions} />
                ) : (
                  <div className="text-center py-12">
                    <p className="text-xl text-muted-foreground">No upcoming races — check back soon</p>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* ---- MY FEED (logged in users) ---- */}
        <MyFeedWidget />

        {/* ---- UPCOMING RACES TABLE ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold tracking-tight">
                {filterDiscipline === "road" && filterGender === "men"   ? "Men's Road Calendar" :
                 filterDiscipline === "road" && filterGender === "women" ? "Women's Road Calendar" :
                 filterDiscipline === "mtb"                              ? "MTB Calendar" :
                 "On the Calendar"}
              </h2>
              <Link href="/races" prefetch={false} className="text-sm text-primary hover:text-primary/80 transition-colors">
                View all races &rarr;
              </Link>
            </div>
            <div className="mb-4">
              <CalendarFilters countries={calendarCountries} basePath="/" />
            </div>
            {upcomingRaces.length > 0 ? (
              <EventListView events={upcomingRaces} />
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No races match your filters.</p>
            )}
          </div>
        </section>

        {/* ---- LATEST RESULTS ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold tracking-tight">Latest Results</h2>
              <Link href="/results" prefetch={false} className="text-sm text-primary hover:text-primary/80 transition-colors">
                View all &rarr;
              </Link>
            </div>
            {recentResults.length > 0 ? (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                {recentResults.map(({ race, event, winner }) => (
                  <Link
                    key={race.id}
                    href={event.slug ? buildEventUrl(event.discipline, event.slug) : getRaceUrl(race, event)}
                    prefetch={false}
                    className="flex items-center gap-3 py-3 px-3 border-b border-border/30 last:border-0 hover:bg-white/[0.03] transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground w-12 shrink-0">{format(toRaceDate(race.date), "MMM d")}</span>
                    <span className="text-sm shrink-0">{getFlag(event.country)}</span>
                    <span className="flex-1 text-sm font-medium truncate group-hover:text-primary transition-colors">{event.name}</span>
                    <span className="text-sm text-muted-foreground truncate hidden sm:block">{winner.name}</span>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${getDisciplineColor(event.discipline)}`}>
                      {getDisciplineLabel(event.discipline)}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No recent results to show.</p>
            )}
          </div>
        </section>

        {/* ---- LATEST INTEL ---- */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 overflow-hidden">
          <div className="min-w-0 overflow-hidden">
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
        </div>
      </main>

        {/* ── VALUE PROP / CTA ─────────────────────────────────────────── */}
        <section className="border-t border-border/50 bg-muted/5">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-14">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl font-black tracking-tight mb-3">Never miss a race you care about</h2>
              <p className="text-muted-foreground">
                Follow your favourite races and riders. Get predictions, results and race intel sent straight to your{" "}
                                <span className="text-foreground font-semibold">WhatsApp</span> — for every WorldTour race.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 p-5 bg-background/40">
                <h3 className="font-bold text-sm uppercase tracking-wide text-primary mb-2">WhatsApp Race Group</h3>
                <p className="text-sm text-muted-foreground">Join the Road Cycling group. Get predictions before the start, podium posts after the finish — all in WhatsApp.</p>
              </div>
              <div className="rounded-lg border border-border/50 p-5 bg-background/40">
                <h3 className="font-bold text-sm uppercase tracking-wide text-primary mb-2">Your Races, Your Riders</h3>
                <p className="text-sm text-muted-foreground">Pick the races and riders you follow. We track them — you just read the update when it lands in your chat.</p>
              </div>
              <div className="rounded-lg border border-border/50 p-5 bg-background/40">
                <h3 className="font-bold text-sm uppercase tracking-wide text-primary mb-2">Backed by Data</h3>
                <p className="text-sm text-muted-foreground">TrueSkill predictions, live startlists, rider intel — all distilled into one message, right when it matters.</p>
              </div>
            </div>
          </div>
        </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <Link href="/" prefetch={false} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo@2x.png" alt="Pro Cycling Predictor" width="24" height="24" className="rounded-sm" />
            <span className="font-semibold text-foreground text-xs uppercase tracking-wide">Pro Cycling Predictor</span>
          </Link>
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

type HeroPick = { name: string; winPct: number; photoUrl: string | null };

function NextRaceHero({
  event: ev,
  genderFilter,
  heroPredictions,
}: {
  event: HomepageEvent;
  genderFilter?: string | null;
  heroPredictions: Map<string, HeroPick[]>;
}) {
  const raceDate = toRaceDate(ev.date);
  const daysUntil = calendarDaysUntil(ev.date);
  const url = ev.slug ? buildEventUrl(ev.discipline, ev.slug) : `/races/${ev.id}`;
  const subLabel = ev.subDiscipline ? getDisciplineShortLabel(ev.subDiscipline) : null;

  const menPicks = heroPredictions.get("men") ?? [];
  const womenPicks = heroPredictions.get("women") ?? [];
  const hasPredictions = menPicks.length > 0 || womenPicks.length > 0;

  // Decide layout: single column if only one gender, two columns if both
  const bothGenders = menPicks.length > 0 && womenPicks.length > 0;

  return (
    <div className="relative">
      <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full hidden md:block" />

      {/* Race identity */}
      <div className="space-y-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">
            {genderFilter === "men" ? "Next Men's Race" : genderFilter === "women" ? "Next Women's Race" : "Next Race"}
          </span>
          {daysUntil >= 0 && daysUntil <= 7 && (
            <Badge className="bg-accent text-accent-foreground text-xs font-bold">
              {daysUntil === 0 ? "TODAY" : daysUntil === 1 ? "TOMORROW" : `IN ${daysUntil} DAYS`}
            </Badge>
          )}
        </div>

        <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">
          <Link href={url} prefetch={false} className="hover:text-primary transition-colors">
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
      </div>

      {/* Predictions panel */}
      {hasPredictions && (
        <div className={`grid gap-4 mb-6 ${bothGenders ? "sm:grid-cols-2" : "max-w-xs"}`}>
          {[
            { gender: "men", picks: menPicks, label: "Men's Favourites" },
            { gender: "women", picks: womenPicks, label: "Women's Favourites" },
          ]
            .filter(({ picks }) => picks.length > 0)
            .map(({ gender, picks, label }) => {
              const catSlug = ev.categories.find(c => c.gender === gender && c.ageCategory === "elite")?.categorySlug;
              const catUrl = catSlug ? `${url}/${catSlug}` : url;
              return (
                <div key={gender} className="rounded-lg border border-border/40 bg-black/20 backdrop-blur-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
                    <Link href={catUrl} className="text-[10px] text-primary hover:underline">Full predictions →</Link>
                  </div>
                  <ol className="divide-y divide-border/20">
                    {picks.map((pick, i) => (
                      <li key={pick.name} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-xs font-bold tabular-nums text-muted-foreground w-4 shrink-0">{i + 1}</span>
                        {pick.photoUrl ? (
                          <img src={pick.photoUrl} alt={pick.name} className="w-6 h-6 rounded-full object-cover shrink-0 opacity-90" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-muted/40 shrink-0" />
                        )}
                        <span className="text-sm font-semibold flex-1 leading-tight truncate">{pick.name}</span>
                        {pick.winPct > 0 && (
                          <span className="text-xs font-bold tabular-nums text-primary shrink-0">{pick.winPct.toFixed(1)}%</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
        </div>
      )}

      {/* CTA row */}
      <div className="flex items-center gap-4">
        <Link
          href={url}
          prefetch={false}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          View all predictions →
        </Link>
        <RaceFollowButton
          eventId={ev.id}
          eventName={ev.name}
          categories={ev.categories}
          size="default"
        />
      </div>
    </div>
  );
}

// UpcomingRaceCard replaced by EventListView (table) on homepage
