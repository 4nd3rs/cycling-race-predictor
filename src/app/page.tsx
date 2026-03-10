import Link from "next/link";
import { Header } from "@/components/header";
import { IntelCard } from "@/components/intel-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, races, raceEvents, riderRumours, riders, raceResults, predictions, raceStartlist } from "@/lib/db";
import { desc, eq, gte, lt, and, sql, isNotNull, isNull, asc } from "drizzle-orm";
import { getStageFavorites, type StageFavorite } from "@/lib/prediction/stage-favorites";
import { format, formatDistanceToNow } from "date-fns";
import { toRaceDate, toDateStr, calendarDaysUntil, todayStr } from "@/lib/utils";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl, buildRaceUrl, buildStageUrl, getDisciplineShortLabel, normalizeUciCategory, getDisciplineColor } from "@/lib/url-utils";
import { EventListView } from "@/components/event-card";
import { MyFeedWidget } from "@/components/my-feed-widget";
import { DisciplineFilter, CalendarFilters } from "@/components/race-filters";
import { RaceFollowButton } from "@/components/race-follow-button";
import { AiPreviewText } from "@/components/ai-preview";
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

async function getHighHypeRaces(discipline?: string | null, gender?: string | null): Promise<{ heroes: HomepageEvent[]; calendar: HomepageEvent[] }> {
  const today = todayStr();
  try {
    // Include upcoming races AND ongoing stage races (start date passed but end date not yet)
    const dateCondition = sql`(${raceEvents.date} >= ${today} OR ${races.endDate} >= ${today})`;
    const conditions: Parameters<typeof and>[0][] = [dateCondition, eq(races.status, "active"), isNull(races.parentRaceId)];
    if (discipline && discipline !== "all") conditions.push(eq(raceEvents.discipline, discipline));
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
          endDate: event.endDate ?? race.endDate,
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
        // Update endDate from race if event doesn't have one
        if (!ev.endDate && race.endDate) ev.endDate = race.endDate;
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

    // Pick heroes by buzz score — show up to 2 concurrent big races
    const heroPool = pool.filter(e => {
      const d = calendarDaysUntil(e.date);
      return d >= -1 && d <= 7; // happening now or within 7 days (include endDate overlap)
    }).concat(
      // Also include races whose endDate hasn't passed yet (ongoing stage races)
      pool.filter(e => {
        if (!e.endDate) return false;
        const endDays = calendarDaysUntil(e.endDate);
        const startDays = calendarDaysUntil(e.date);
        return endDays >= 0 && startDays < 0; // already started, not yet finished
      })
    );
    // Deduplicate
    const heroPoolDeduped = [...new Map(heroPool.map(e => [e.id, e])).values()];
    const fallbackPool = pool;

    const scoredPool = (heroPoolDeduped.length > 0 ? heroPoolDeduped : fallbackPool).map(e => ({
      event: e,
      buzzScore: getBuzzScore(e.hypeScore, e.newsCount, Math.max(0, calendarDaysUntil(e.date))),
    })).sort((a, b) => b.buzzScore - a.buzzScore);

    // Take top 2 heroes if the second one is also high-hype (buzz >= 80)
    const heroes: HomepageEvent[] = [];
    if (scoredPool[0]) heroes.push(scoredPool[0].event);
    if (scoredPool[1] && scoredPool[1].buzzScore >= 80) heroes.push(scoredPool[1].event);

    const heroIds = new Set(heroes.map(h => h.id));
    const calendar = pool.filter(e => !heroIds.has(e.id)).slice(0, 20);

    return { heroes, calendar };
  } catch {
    return { heroes: [], calendar: [] };
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

// ── Latest Results ──────────────────────────────────────────────────────────

interface PodiumEntry {
  position: number;
  riderName: string;
  nationality: string | null;
  photoUrl: string | null;
}

interface CategoryPodium {
  gender: string;
  ageCategory: string;
  podium: PodiumEntry[];
}

interface EventPodium {
  eventId: string;
  eventName: string;
  eventSlug: string | null;
  country: string | null;
  discipline: string;
  date: string;
  uciCategory: string | null;
  categories: CategoryPodium[];
}

async function getRecentResults(): Promise<EventPodium[]> {
  const today = todayStr();
  const lookback = new Date(Date.now() - 21 * 86400 * 1000).toISOString().substring(0, 10);
  try {
    const rows = await db
      .select({
        raceId: races.id,
        raceDate: races.date,
        raceGender: races.gender,
        raceAgeCategory: races.ageCategory,
        raceUciCategory: races.uciCategory,
        eventId: raceEvents.id,
        eventName: raceEvents.name,
        eventSlug: raceEvents.slug,
        eventCountry: raceEvents.country,
        eventDiscipline: raceEvents.discipline,
        position: raceResults.position,
        riderName: riders.name,
        riderNat: riders.nationality,
        riderPhoto: riders.photoUrl,
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(
        and(
          lt(races.date, today),
          gte(races.date, lookback),
          sql`${raceResults.position} >= 1`,
          sql`${raceResults.position} <= 3`,
        )
      )
      .orderBy(desc(races.date), asc(raceResults.position))
      .limit(500);

    const eventsMap = new Map<string, EventPodium>();
    for (const row of rows) {
      if (!eventsMap.has(row.eventId)) {
        eventsMap.set(row.eventId, {
          eventId: row.eventId,
          eventName: row.eventName,
          eventSlug: row.eventSlug,
          country: row.eventCountry,
          discipline: row.eventDiscipline,
          date: row.raceDate,
          uciCategory: row.raceUciCategory ?? null,
          categories: [],
        });
      }
      const ev = eventsMap.get(row.eventId)!;
      const gender = row.raceGender || "men";
      const ageCategory = row.raceAgeCategory || "elite";

      // For MTB: show only position 1 per category; for road: top 3
      const maxPositions = row.eventDiscipline === "mtb" ? 1 : 3;

      let cat = ev.categories.find(c => c.gender === gender && c.ageCategory === ageCategory);
      if (!cat) {
        cat = { gender, ageCategory, podium: [] };
        ev.categories.push(cat);
      }
      if (row.position && cat.podium.length < maxPositions) {
        cat.podium.push({
          position: row.position,
          riderName: row.riderName,
          nationality: row.riderNat,
          photoUrl: row.riderPhoto ?? null,
        });
      }
    }

    return Array.from(eventsMap.values())
      .filter(e => e.categories.some(c => c.podium.length > 0))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6);
  } catch {
    return [];
  }
}

/** Stage progress info for hero display */
interface StageProgress {
  totalStages: number;
  completedStages: number;
  todayStage: { number: number; name: string; profileType: string | null; distanceKm: string | null; elevationM: number | null; aiPreview: string | null } | null;
  gcLeader: { name: string; nationality: string | null; photoUrl: string | null } | null;
  jerseys?: {
    gc?: { riderName: string; riderId: string };
    points?: { riderName: string; riderId: string };
    kom?: { riderName: string; riderId: string };
    youth?: { riderName: string; riderId: string };
  };
  todayStageFavorites?: StageFavorite[];
}

async function getHeroStageProgress(event: HomepageEvent): Promise<StageProgress | null> {
  // Find the elite-men parent race to look up child stages
  const eliteMen = event.categories.find(c => c.ageCategory === "elite" && c.gender === "men");
  if (!eliteMen) return null;

  try {
    // Check if this race is a stage race
    const [parentRace] = await db.select({ raceType: races.raceType, id: races.id })
      .from(races).where(eq(races.id, eliteMen.id)).limit(1);
    if (!parentRace || parentRace.raceType !== "stage_race") return null;

    // Get all child stages
    const stages = await db.select({
      id: races.id,
      stageNumber: races.stageNumber,
      name: races.name,
      date: races.date,
      status: races.status,
    })
      .from(races)
      .where(eq(races.parentRaceId, parentRace.id))
      .orderBy(asc(races.stageNumber));

    if (stages.length === 0) return null;

    const today = todayStr();
    const completedStages = stages.filter(s => s.status === "completed" || (s.date && s.date < today)).length;
    const todayStageRow = stages.find(s => s.date === today);

    // Fetch classification leaders from parent race + GC leader fallback
    const [parentRaceRow] = await db.select({
      classificationLeaders: races.classificationLeaders,
    }).from(races).where(eq(races.id, parentRace.id)).limit(1);

    const classLeaders = parentRaceRow?.classificationLeaders as StageProgress["jerseys"] & { updatedAfterStage?: number } | null;

    // Get GC leader from classification leaders or from results
    let gcLeader: StageProgress["gcLeader"] = null;
    if (classLeaders?.gc) {
      const [rider] = await db.select({ name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
        .from(riders).where(eq(riders.id, classLeaders.gc.riderId)).limit(1);
      if (rider) gcLeader = { name: rider.name, nationality: rider.nationality, photoUrl: rider.photoUrl ?? null };
    }
    if (!gcLeader) {
      const lastCompleted = [...stages].reverse().find(s => s.status === "completed");
      if (lastCompleted) {
        const [leader] = await db.select({
          name: riders.name,
          nationality: riders.nationality,
          photoUrl: riders.photoUrl,
        })
          .from(raceResults)
          .innerJoin(riders, eq(raceResults.riderId, riders.id))
          .where(and(eq(raceResults.raceId, parentRace.id), eq(raceResults.position, 1)))
          .limit(1);
        if (leader) {
          gcLeader = { name: leader.name, nationality: leader.nationality, photoUrl: leader.photoUrl ?? null };
        }
      }
    }

    // Build jerseys object
    const jerseys: StageProgress["jerseys"] = {};
    if (classLeaders?.gc) jerseys.gc = { riderName: classLeaders.gc.riderName, riderId: classLeaders.gc.riderId };
    if (classLeaders?.points) jerseys.points = { riderName: classLeaders.points.riderName, riderId: classLeaders.points.riderId };
    if (classLeaders?.kom) jerseys.kom = { riderName: classLeaders.kom.riderName, riderId: classLeaders.kom.riderId };
    if (classLeaders?.youth) jerseys.youth = { riderName: classLeaders.youth.riderName, riderId: classLeaders.youth.riderId };

    // Today's stage details
    let todayStage: StageProgress["todayStage"] = null;
    let todayStageFavorites: StageFavorite[] | undefined;
    if (todayStageRow) {
      // Fetch full stage details
      const [stageDetail] = await db.select({
        profileType: races.profileType,
        distanceKm: races.distanceKm,
        elevationM: races.elevationM,
        aiPreview: races.aiPreview,
      }).from(races).where(eq(races.id, todayStageRow.id)).limit(1);

      todayStage = {
        number: todayStageRow.stageNumber ?? 0,
        name: todayStageRow.name,
        profileType: stageDetail?.profileType ?? null,
        distanceKm: stageDetail?.distanceKm ?? null,
        elevationM: stageDetail?.elevationM ?? null,
        aiPreview: stageDetail?.aiPreview ?? null,
      };

      // Get stage-specific favorites
      try {
        todayStageFavorites = await getStageFavorites(
          parentRace.id,
          stageDetail?.profileType ?? null,
          event.discipline,
          5,
        );
      } catch { /* non-critical */ }
    }

    return {
      totalStages: stages.length,
      completedStages,
      todayStage,
      gcLeader,
      jerseys: Object.keys(jerseys).length > 0 ? jerseys : undefined,
      todayStageFavorites,
    };
  } catch {
    return null;
  }
}

/** Fetch top 5 predictions per elite race category for the hero event */
async function getHeroPredictions(event: HomepageEvent): Promise<Map<string, Array<{ riderId: string; name: string; winPct: number; photoUrl: string | null }>>> {
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
              riderId: r.rider.id,
              name: r.rider.name,
              winPct: r.prediction.winProbability ? Number(r.prediction.winProbability) * 100 : 0,
              photoUrl: r.rider.photoUrl ?? null,
            })),
        };
      })
    );
    const map = new Map<string, Array<{ riderId: string; name: string; winPct: number; photoUrl: string | null }>>();
    for (const { gender, picks } of results) {
      if (picks.length > 0) map.set(gender, picks);
    }
    return map;
  } catch { return new Map(); }
}

interface HeroAiPreview {
  text: string;
  riderLinks: Array<{ name: string; id: string }>;
}

async function getHeroAiPreview(event: HomepageEvent): Promise<HeroAiPreview | null> {
  const eliteCat = event.categories.find(c => c.ageCategory === "elite" && c.gender === "men")
    ?? event.categories.find(c => c.ageCategory === "elite");
  if (!eliteCat) return null;
  try {
    const [[row], startlistRiders] = await Promise.all([
      db.select({ aiPreview: races.aiPreview }).from(races).where(eq(races.id, eliteCat.id)).limit(1),
      db.select({ riderId: riders.id, name: riders.name })
        .from(raceStartlist)
        .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
        .where(eq(raceStartlist.raceId, eliteCat.id))
        .limit(100),
    ]);
    if (!row?.aiPreview) return null;
    return {
      text: row.aiPreview,
      riderLinks: startlistRiders.map(r => ({ name: r.name, id: r.riderId })),
    };
  } catch { return null; }
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
    const conditions: Parameters<typeof and>[0][] = [gte(raceEvents.date, today), isNull(races.parentRaceId)];
    if (discipline && discipline !== "all") conditions.push(eq(raceEvents.discipline, discipline));
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

  const [{ heroes: heroRaces, calendar: highHypeRaces }, latestIntel, recentResults, filteredRaces, calendarCountries] = await Promise.all([
    getHighHypeRaces(filterDiscipline, filterGender),
    getLatestIntel(),
    getRecentResults(),
    hasFilters ? getFilteredCalendarEvents(filterDiscipline, filterGender, filterCountry, filterCat) : Promise.resolve([]),
    getUpcomingCountries(),
  ]);
  const upcomingRaces = hasFilters ? filteredRaces : highHypeRaces;

  // Fetch predictions, stage progress, and AI preview for each hero race
  const heroData = await Promise.all(
    heroRaces.map(async (ev) => ({
      event: ev,
      predictions: await getHeroPredictions(ev),
      stageProgress: await getHeroStageProgress(ev),
      aiPreview: await getHeroAiPreview(ev),
    }))
  );

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

        {/* ---- RACE SPOTLIGHT(S) ---- */}
        {heroData.length > 0 ? heroData.map((hero, idx) => {
          const raceImg = getRaceImage(hero.event.slug);
          return (
            <section key={hero.event.id} className={`${idx < heroData.length - 1 ? "border-b border-border/30" : "border-b border-border/50"} relative overflow-hidden`}>
              {raceImg && (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${raceImg.src})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
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
              <div className={`relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl ${heroData.length === 1 ? "py-10 md:py-16" : "py-8 md:py-10"}`}>
                <NextRaceHero
                  event={hero.event}
                  genderFilter={filterGender}
                  heroPredictions={hero.predictions}
                  stageProgress={hero.stageProgress}
                  aiPreview={hero.aiPreview}
                  compact={heroData.length > 1}
                />
              </div>
            </section>
          );
        }) : (
          <section className="border-b border-border/50">
            <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 md:py-16">
              <div className="text-center py-12">
                <p className="text-xl text-muted-foreground">No upcoming races — check back soon</p>
              </div>
            </div>
          </section>
        )}

        {/* ---- MY FEED (logged in users) ---- */}
        <MyFeedWidget />

        {/* ---- LATEST RESULTS ---- */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold tracking-tight">Latest Results</h2>
              <Link href="/results" prefetch={false} className="text-sm text-primary hover:text-primary/80 transition-colors">
                View all &rarr;
              </Link>
            </div>
            {recentResults.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentResults.map((ev) => (
                  <ResultCard key={ev.eventId} ev={ev} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No recent results to show.</p>
            )}
          </div>
        </section>

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
              <EventListView events={upcomingRaces.slice(0, 10)} />
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No races match your filters.</p>
            )}
          </div>
        </section>

        {/* ---- LATEST NEWS & BUZZ ---- */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-10 overflow-hidden mb-12">
          <div className="min-w-0 overflow-hidden">
              <h2 className="text-xl font-bold tracking-tight mb-6">
                Latest News & Buzz
              </h2>
              {latestIntel.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  {latestIntel.map(({ rumour, rider }) => (
                    <div key={rumour.id} className="border-b border-[#3A3530]/50">
                      <IntelCard
                        riderId={rider.id}
                        riderName={rider.name}
                        summary={rumour.summary}
                        tipCount={rumour.tipCount}
                        lastUpdated={rumour.lastUpdated}
                      />
                    </div>
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

type HeroPick = { riderId: string; name: string; winPct: number; photoUrl: string | null };

function NextRaceHero({
  event: ev,
  genderFilter,
  heroPredictions,
  stageProgress,
  aiPreview,
  compact,
}: {
  event: HomepageEvent;
  genderFilter?: string | null;
  heroPredictions: Map<string, HeroPick[]>;
  stageProgress?: StageProgress | null;
  aiPreview?: HeroAiPreview | null;
  compact?: boolean;
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
      <div className={`space-y-3 ${compact ? "mb-4" : "mb-6"}`}>
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

        <h1 className={`font-black tracking-tight ${compact ? "text-2xl sm:text-3xl md:text-4xl" : "text-3xl sm:text-4xl md:text-5xl"}`}>
          <Link href={url} prefetch={false} className="hover:text-primary transition-colors">
            {ev.name}
          </Link>
        </h1>

        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {getFlag(ev.country)}{" "}
            {ev.endDate && ev.endDate !== ev.date
              ? (() => {
                  const startD = toRaceDate(ev.date);
                  const endD = toRaceDate(ev.endDate);
                  return startD.getMonth() === endD.getMonth()
                    ? `${format(startD, "MMMM d")} - ${format(endD, "d")}`
                    : `${format(startD, "MMMM d")} - ${format(endD, "MMMM d")}`;
                })()
              : format(raceDate, "EEEE, MMMM d")}
          </span>
          <Badge variant="outline" className={getDisciplineColor(ev.discipline)}>
            {getDisciplineLabel(ev.discipline)}{subLabel ? ` ${subLabel}` : ""}
          </Badge>
          {ev.uciCategory && (
            <Badge variant="outline" className="border-primary/50 text-primary font-mono font-semibold text-xs">{normalizeUciCategory(ev.uciCategory)}</Badge>
          )}
        </div>
      </div>

      {/* Stage race progress + jerseys */}
      {stageProgress && (
        <div className="mb-6 space-y-3">
          {/* Jersey badges row */}
          {stageProgress.jerseys && Object.keys(stageProgress.jerseys).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {([
                { key: "gc" as const, label: "GC", color: "text-[#E3A72F]", border: "border-[#E3A72F]/40" },
                { key: "points" as const, label: "PTS", color: "text-[#00A651]", border: "border-[#00A651]/40" },
                { key: "kom" as const, label: "KOM", color: "text-[#E2424D]", border: "border-[#E2424D]/40" },
                { key: "youth" as const, label: "YTH", color: "text-white", border: "border-white/30" },
              ] as const).filter(j => stageProgress.jerseys?.[j.key]).map(j => {
                const leader = stageProgress.jerseys![j.key]!;
                const surname = leader.riderName.split(" ").pop()?.toUpperCase() ?? leader.riderName;
                return (
                  <Link key={j.key} href={`/riders/${leader.riderId}`} prefetch={false} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border ${j.border} bg-card/50 hover:bg-card/80 transition-colors`}>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${j.color}`}>{j.label}</span>
                    <span className="text-xs font-bold text-foreground">{surname}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Stage info + progress */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 max-w-lg">
            {stageProgress.gcLeader && !stageProgress.jerseys?.gc && (
              <div className="flex items-center gap-3 bg-card px-3 py-2 border-l-2 border-[#E3A72F] shadow-sm shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#E3A72F] w-6 text-center">GC</span>
                {stageProgress.gcLeader.photoUrl ? (
                  <img src={stageProgress.gcLeader.photoUrl} alt={stageProgress.gcLeader.name} className="w-8 h-8 rounded-full object-cover shrink-0 grayscale hover:grayscale-0 transition-all border border-border/50" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-border shrink-0 border border-border/50" />
                )}
                <span className="font-bold text-sm tracking-tight leading-none text-foreground truncate min-w-0 max-w-[140px]">{stageProgress.gcLeader.name}</span>
              </div>
            )}

            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">STAGE RACE</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {stageProgress.completedStages} / {stageProgress.totalStages} DONE
                </span>
              </div>
              {stageProgress.todayStage && (() => {
                const eliteCat = ev.categories.find(c => c.ageCategory === "elite" && c.categorySlug);
                const stageUrl = ev.slug && eliteCat?.categorySlug
                  ? buildStageUrl(ev.discipline, ev.slug, eliteCat.categorySlug, stageProgress.todayStage.number)
                  : null;

                const profileLabel = stageProgress.todayStage.profileType
                  ? { flat: "Flat", hilly: "Hilly", mountain: "Mountain", tt: "Time Trial", cobbles: "Cobbles" }[stageProgress.todayStage.profileType] ?? stageProgress.todayStage.profileType
                  : null;

                const stageEl = (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                    <span className="font-bold text-[13px] text-foreground uppercase tracking-wide">Stage {stageProgress.todayStage.number} Today</span>
                    {profileLabel && (
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {profileLabel}
                        {stageProgress.todayStage.distanceKm && ` -- ${parseFloat(stageProgress.todayStage.distanceKm).toFixed(0)} km`}
                        {stageProgress.todayStage.elevationM && ` -- ${stageProgress.todayStage.elevationM}m elev.`}
                      </span>
                    )}
                  </div>
                );

                return stageUrl ? (
                  <Link href={stageUrl} prefetch={false} className="hover:opacity-80 transition-opacity">
                    {stageEl}
                  </Link>
                ) : stageEl;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Predictions + AI Preview */}
      {(() => {
        // If today's stage has favorites, show those instead of overall predictions for men
        const hasStageFavs = stageProgress?.todayStageFavorites && stageProgress.todayStageFavorites.length > 0;
        const stageAiPreview = stageProgress?.todayStage?.aiPreview;
        const effectiveAiPreview = stageAiPreview ? { text: stageAiPreview, riderLinks: aiPreview?.riderLinks ?? [] } : aiPreview;
        const effectiveAiPreviewLabel = stageAiPreview
          ? `Stage ${stageProgress?.todayStage?.number} Preview`
          : "AI Race Preview";

        // For men's picks, use stage favorites when available
        const effectiveMenPicks = hasStageFavs ? stageProgress!.todayStageFavorites! : menPicks;
        const effectiveMenLabel = hasStageFavs
          ? `Stage ${stageProgress?.todayStage?.number} Favourites`
          : "Men's Favourites";
        const effectiveHasPredictions = effectiveMenPicks.length > 0 || womenPicks.length > 0;
        const effectiveBothGenders = effectiveMenPicks.length > 0 && womenPicks.length > 0;

        return (effectiveHasPredictions || effectiveAiPreview) ? (
        <div className={`flex flex-col ${effectiveAiPreview && effectiveHasPredictions ? "lg:flex-row" : ""} gap-4 mb-6`}>
          {/* Predictions panel */}
          {effectiveHasPredictions && (
            <div className={`grid gap-4 ${effectiveBothGenders ? "sm:grid-cols-2" : "max-w-xs"} ${effectiveAiPreview ? "lg:w-1/2 lg:max-w-none" : ""}`}>
              {[
                { gender: "men", picks: effectiveMenPicks, label: effectiveMenLabel },
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
                            <Link href={`/riders/${pick.riderId}`} prefetch={false} className="text-sm font-semibold flex-1 leading-tight truncate hover:text-primary transition-colors">{pick.name}</Link>
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

          {/* AI Preview (stage-specific when available) */}
          {effectiveAiPreview && (
            <div className={`rounded-lg border border-border/40 bg-black/20 backdrop-blur-sm overflow-hidden ${effectiveHasPredictions ? "lg:w-1/2" : "max-w-lg"}`}>
              <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{effectiveAiPreviewLabel}</span>
              </div>
              <div className="px-3 py-3">
                <AiPreviewText text={effectiveAiPreview.text} riderLinks={effectiveAiPreview.riderLinks} clampLines={compact ? 6 : 10} />
              </div>
            </div>
          )}
        </div>
      ) : null;
      })()}

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

// ── ResultCard ────────────────────────────────────────────────────────────────

const MEDAL = ["🥇", "🥈", "🥉"];
const CAT_LABEL: Record<string, string> = {
  "elite-men":   "Elite Men",
  "elite-women": "Elite Women",
  "junior-men":  "Junior Men",
  "junior-women":"Junior Women",
  "u23-men":     "U23 Men",
  "u23-women":   "U23 Women",
};

function catLabel(ageCategory: string, gender: string) {
  return CAT_LABEL[`${ageCategory}-${gender}`] ?? `${ageCategory} ${gender}`;
}

function formatRiderName(name: string) {
  const words = name.trim().split(" ");
  if (words.length <= 1) return name.toUpperCase();
  
  // Find words that are strictly ALL CAPS
  const allCapsWords = words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w));
  
  if (allCapsWords.length > 0 && allCapsWords.length < words.length) {
    // Assume all caps words are the last name
    const lastName = allCapsWords.join(" ");
    const firstName = words.filter(w => !allCapsWords.includes(w)).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    return `${lastName} ${firstName}`;
  }
  
  // Fallback: Assume last word is last name
  const lastName = words.pop()!.toUpperCase();
  const firstName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return `${lastName} ${firstName}`;
}

function ResultCard({ ev }: { ev: EventPodium }) {
  const url = ev.eventSlug ? buildEventUrl(ev.discipline, ev.eventSlug) : `/races/${ev.eventId}`;
  const isMtb = ev.discipline === "mtb";

  // Sort categories: elite first, then men before women within tier
  const sorted = [...ev.categories].sort((a, b) => {
    const tierOrder = (c: CategoryPodium) => c.ageCategory === "elite" ? 0 : c.ageCategory === "u23" ? 1 : 2;
    const genderOrder = (c: CategoryPodium) => c.gender === "men" ? 0 : 1;
    return tierOrder(a) - tierOrder(b) || genderOrder(a) - genderOrder(b);
  });

  const menCat    = sorted.find(c => c.gender === "men"   && c.ageCategory === "elite");
  const womenCat  = sorted.find(c => c.gender === "women" && c.ageCategory === "elite");
  const otherCats = sorted.filter(c => !(c.ageCategory === "elite" && (c.gender === "men" || c.gender === "women")));

  return (
    <div className="flex flex-col group relative bg-card h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <Link href={url} prefetch={false} className="inline-block group-hover:text-primary transition-colors">
            <h3 className="font-bold text-lg leading-tight uppercase tracking-tight">{ev.eventName}</h3>
          </Link>
          <div className="flex items-center gap-2 mt-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>{format(toRaceDate(ev.date), "MMM d")}</span>
          </div>
        </div>
        <div className="text-xl shrink-0 group-hover:scale-110 transition-transform">{getFlag(ev.country)}</div>
      </div>

      <div className="w-full h-px bg-border/50 mb-4" />

      {/* Body */}
      <div className="flex-1">
        {isMtb ? (
          // MTB: winner per category in a compact list
          <div className="space-y-4">
            {sorted.map(cat => (
              <div key={`${cat.ageCategory}-${cat.gender}`}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 border-b border-border/30 pb-1 w-full">
                  {catLabel(cat.ageCategory, cat.gender)}
                </p>
                {cat.podium[0] ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black font-display text-primary w-4 text-left">1</span>
                    <span className="text-[13px] font-semibold truncate leading-tight flex-1">
                      {formatRiderName(cat.podium[0].riderName)}
                    </span>
                    {cat.podium[0].nationality && (
                      <span className="text-xs shrink-0">{getFlag(cat.podium[0].nationality)}</span>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          // Road: top 3 in two columns
          <div className={`grid gap-x-6 gap-y-6 ${menCat && womenCat ? "grid-cols-2" : "grid-cols-1"}`}>
            {[
              { cat: menCat,   label: "Men" },
              { cat: womenCat, label: "Women" },
            ]
              .filter(({ cat }) => cat && cat.podium.length > 0)
              .map(({ cat, label }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#7A7065] mb-2 border-b border-[#3A3530] pb-1 w-full">{label}</p>
                  <ol className="flex flex-col">
                    {cat!.podium.map((entry, i) => (
                      <li key={i} className="flex items-center gap-2 py-1.5 border-b border-[#3A3530]/50 last:border-0">
                        <span className={`text-sm font-black font-display w-3 shrink-0 text-left ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>
                          {i + 1}
                        </span>
                        <span className="text-sm font-semibold truncate flex-1 leading-none tracking-tight">
                          {formatRiderName(entry.riderName)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        )}
        
        {/* MTB: other cats beyond elite already included above; for road show non-elite winners inline */}
        {!isMtb && otherCats.length > 0 && (
          <div className="mt-5 space-y-3">
            {otherCats.map(cat => (
              <div key={`${cat.ageCategory}-${cat.gender}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#7A7065] mb-1.5 border-b border-[#3A3530] pb-1 w-full">
                  {catLabel(cat.ageCategory, cat.gender)}
                </p>
                {cat.podium[0] && (
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-sm font-black font-display text-primary w-3 shrink-0 text-left">1</span>
                    <span className="text-sm font-semibold truncate flex-1 leading-none tracking-tight">
                      {formatRiderName(cat.podium[0].riderName)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// UpcomingRaceCard replaced by EventListView (table) on homepage
