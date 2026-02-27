import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { TelegramSubscribeButton } from "@/components/telegram-subscribe-button";
import { RaceLinksSection } from "@/components/race-links";
import { FollowButton } from "@/components/follow-button";
import {
  db,
  races,
  predictions,
  riders,
  raceStartlist,
  raceResults,
  riderRumours,
  raceEvents,
  raceNews,
} from "@/lib/db";
import { eq, and, or, desc, isNotNull, isNull, asc, sql as sqlFn } from "drizzle-orm";
import { format, formatDistanceToNow } from "date-fns";
import {
  isValidDiscipline,
  getDisciplineLabel,
  getSubDisciplineShortLabel,
  buildCategoryUrl,
  generateCategorySlug,
} from "@/lib/url-utils";
import { formatCategoryDisplay } from "@/lib/category-utils";

interface PageProps {
  params: Promise<{ discipline: string; eventSlug: string }>;
}

// ── Weather ──────────────────────────────────────────────────────────────────

const COUNTRY_COORDS: Record<string, { lat: number; lon: number; city: string }> = {
  BEL: { lat: 50.85, lon: 4.35,  city: "Belgium" },
  ITA: { lat: 41.90, lon: 12.49, city: "Italy" },
  FRA: { lat: 48.85, lon: 2.35,  city: "France" },
  ESP: { lat: 40.41, lon: -3.70, city: "Spain" },
  NED: { lat: 52.37, lon: 4.89,  city: "Netherlands" },
  SUI: { lat: 46.95, lon: 7.44,  city: "Switzerland" },
  GBR: { lat: 51.50, lon: -0.12, city: "UK" },
  GER: { lat: 52.52, lon: 13.40, city: "Germany" },
  NOR: { lat: 59.91, lon: 10.75, city: "Norway" },
  DEN: { lat: 55.67, lon: 12.57, city: "Denmark" },
  AUT: { lat: 48.20, lon: 16.37, city: "Austria" },
  POL: { lat: 52.22, lon: 21.01, city: "Poland" },
  POR: { lat: 38.71, lon: -9.14, city: "Portugal" },
  AUS: { lat: -33.87, lon: 151.21, city: "Australia" },
};

type RaceWeather = { tempMax: number; tempMin: number; precipMm: number; windKmh: number; weatherCode: number; city: string } | null;

async function getRaceWeather(country: string | null, date: string): Promise<RaceWeather> {
  if (!country || !COUNTRY_COORDS[country]) return null;
  const { lat, lon, city } = COUNTRY_COORDS[country];
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode&timezone=auto&start_date=${date}&end_date=${date}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.daily;
    if (!d?.temperature_2m_max?.[0]) return null;
    return {
      tempMax: Math.round(d.temperature_2m_max[0]),
      tempMin: Math.round(d.temperature_2m_min[0]),
      precipMm: Math.round((d.precipitation_sum[0] ?? 0) * 10) / 10,
      windKmh: Math.round(d.windspeed_10m_max[0] ?? 0),
      weatherCode: d.weathercode[0] ?? 0,
      city,
    };
  } catch {
    return null;
  }
}

function wmoToEmoji(code: number): { emoji: string; desc: string } {
  if (code === 0) return { emoji: "☀️", desc: "Clear sky" };
  if (code <= 3) return { emoji: "🌤️", desc: "Partly cloudy" };
  if (code <= 48) return { emoji: "🌫️", desc: "Foggy" };
  if (code <= 57) return { emoji: "🌦️", desc: "Drizzle" };
  if (code <= 67) return { emoji: "🌧️", desc: "Rain" };
  if (code <= 77) return { emoji: "❄️", desc: "Snow" };
  if (code <= 82) return { emoji: "🌧️", desc: "Showers" };
  if (code <= 86) return { emoji: "🌨️", desc: "Snow showers" };
  if (code <= 99) return { emoji: "⛈️", desc: "Thunderstorm" };
  return { emoji: "🌡️", desc: "Unknown" };
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function getEventBySlug(discipline: string, slug: string) {
  try {
    const [event] = await db
      .select()
      .from(raceEvents)
      .where(and(eq(raceEvents.discipline, discipline), eq(raceEvents.slug, slug)))
      .limit(1);
    return event ?? null;
  } catch { return null; }
}

async function getEventCategories(eventId: string) {
  try {
    const eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, eventId))
      .orderBy(asc(races.ageCategory), asc(races.gender));

    return Promise.all(
      eventRaces.map(async (race) => {
        const [[sl], [res]] = await Promise.all([
          db.select({ count: sqlFn<number>`count(*)` })
            .from(raceStartlist)
            .where(eq(raceStartlist.raceId, race.id)),
          db.select({ count: sqlFn<number>`count(*)` })
            .from(raceResults)
            .where(eq(raceResults.raceId, race.id)),
        ]);
        return {
          race,
          riderCount: Number(sl?.count) || 0,
          resultCount: Number(res?.count) || 0,
        };
      })
    );
  } catch { return []; }
}

async function getTopPredictions(raceId: string, limit = 5) {
  try {
    return await db
      .select({ prediction: predictions, rider: riders })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .where(eq(predictions.raceId, raceId))
      .orderBy(asc(predictions.predictedPosition))
      .limit(limit);
  } catch { return []; }
}

async function getTopResults(raceId: string, limit = 5) {
  try {
    return await db
      .select({ result: raceResults, rider: riders })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(and(eq(raceResults.raceId, raceId), isNotNull(raceResults.position)))
      .orderBy(asc(raceResults.position))
      .limit(limit);
  } catch { return []; }
}

async function getRaceIntel(raceId: string) {
  try {
    const rows = await db
      .select({ rumour: riderRumours, rider: riders })
      .from(riderRumours)
      .innerJoin(riders, eq(riderRumours.riderId, riders.id))
      .innerJoin(raceStartlist, eq(raceStartlist.riderId, riders.id))
      .where(and(eq(raceStartlist.raceId, raceId), isNotNull(riderRumours.summary)))
      .orderBy(desc(riderRumours.lastUpdated))
      .limit(10);
    // Deduplicate by rider
    const seen = new Set<string>();
    return rows.filter(({ rider }) => {
      if (seen.has(rider.id)) return false;
      seen.add(rider.id);
      return true;
    }).slice(0, 3);
  } catch { return []; }
}

async function getEventNews(eventId: string) {
  try {
    return await db
      .select()
      .from(raceNews)
      .where(eq(raceNews.raceEventId, eventId))
      .orderBy(desc(raceNews.publishedAt))
      .limit(6);
  } catch { return []; }
}

async function getRaceSpecificNews(eventId: string, raceId: string, gender?: string | null) {
  try {
    // For women's races: only show articles explicitly tagged to this race (avoid men's general news leaking in)
    // For men's races: also include neutral articles (race_id IS NULL)
    const isWomen = gender === "women";
    return await db
      .select()
      .from(raceNews)
      .where(and(
        eq(raceNews.raceEventId, eventId),
        isWomen
          ? eq(raceNews.raceId, raceId)
          : or(eq(raceNews.raceId, raceId), isNull(raceNews.raceId))
      ))
      .orderBy(desc(raceNews.publishedAt))
      .limit(3);
  } catch { return []; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryToFlag(code?: string | null) {
  if (!code) return "";
  const c = code.toUpperCase();
  const map: Record<string, string> = {
    GER:"DE", USA:"US", RSA:"ZA", GBR:"GB", NED:"NL", DEN:"DK",
    SUI:"CH", AUT:"AT", BEL:"BE", FRA:"FR", ITA:"IT", ESP:"ES",
    POR:"PT", NOR:"NO", SWE:"SE", FIN:"FI", POL:"PL", CZE:"CZ",
    AUS:"AU", NZL:"NZ", JPN:"JP", COL:"CO", ECU:"EC", SLO:"SI",
    CRO:"HR", UKR:"UA", KAZ:"KZ", ERI:"ER", ETH:"ET", RWA:"RW",
  };
  const a2 = c.length === 2 ? c : (map[c] || c.slice(0, 2));
  return String.fromCodePoint(...[...a2].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}


const PODIUM_BADGE = ["bg-yellow-500 text-yellow-950", "bg-gray-300 text-gray-800", "bg-amber-600 text-amber-50"];

// ── Page ──────────────────────────────────────────────────────────────────────


function getCategoryLabel(categorySlug?: string | null, ageCategory?: string | null, gender?: string | null): string {
  if (categorySlug) {
    const labels: Record<string, string> = {
      "elite-men": "Elite Men", "elite-women": "Elite Women",
      "u23-men": "U23 Men", "u23-women": "U23 Women",
      "junior-men": "Junior Men", "junior-women": "Junior Women",
      "under-23-men": "U23 Men", "under-23-women": "U23 Women",
    };
    if (labels[categorySlug]) return labels[categorySlug];
    // Fallback: capitalise slug
    return categorySlug.replace(/-/g, " ").replace(/\w/g, c => c.toUpperCase());
  }
  if (ageCategory === "u23") return gender === "women" ? "U23 Women" : "U23 Men";
  if (ageCategory === "junior") return gender === "women" ? "Junior Women" : "Junior Men";
  return gender === "women" ? "Elite Women" : "Elite Men";
}

export default async function EventPage({ params }: PageProps) {
  const { discipline, eventSlug } = await params;

  if (!isValidDiscipline(discipline)) notFound();

  const event = await getEventBySlug(discipline, eventSlug);
  if (!event) notFound();

  const disciplineLabel = getDisciplineLabel(discipline);
  const eventDate = new Date(event.date + "T12:00:00");

  // All data in parallel
  const [categories, latestNews, weather] = await Promise.all([
    getEventCategories(event.id),
    getEventNews(event.id),
    getRaceWeather(event.country, event.date),
  ]);

  // Sort: elite first, then u23, junior, masters; men before women within tier
  const tierOrder: Record<string, number> = { elite: 0, u23: 1, junior: 2, masters: 3 };
  const sorted = [...categories].sort((a, b) => {
    const ta = tierOrder[a.race.ageCategory ?? "masters"] ?? 4;
    const tb = tierOrder[b.race.ageCategory ?? "masters"] ?? 4;
    if (ta !== tb) return ta - tb;
    return (a.race.gender === "men" ? 0 : 1) - (b.race.gender === "men" ? 0 : 1);
  });

  const eliteRaces = sorted.filter(c => c.race.ageCategory === "elite");
  const otherRaces = sorted.filter(c => c.race.ageCategory !== "elite");
  // Fetch predictions + results + intel + per-race news for elite races
  const [predictionsPerRace, resultsPerRace, intelPerRace, newsPerRace, otherResultsPerRace, otherPredictionsPerRace] = await Promise.all([
    Promise.all(eliteRaces.map(c => getTopPredictions(c.race.id, 5))),
    Promise.all(eliteRaces.map(c => getTopResults(c.race.id, 5))),
    Promise.all(eliteRaces.map(c => getRaceIntel(c.race.id))),
    Promise.all(eliteRaces.map(c => getRaceSpecificNews(event.id, c.race.id, c.race.gender))),
    Promise.all(otherRaces.map(c => getTopResults(c.race.id, 5))),
    Promise.all(otherRaces.map(c => getTopPredictions(c.race.id, 5))),
  ]);

  const wx = weather ? wmoToEmoji(weather.weatherCode) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="border-b border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground flex-wrap">
              <Link href="/races" className="hover:text-foreground transition-colors">Races</Link>
              <span>/</span>
              <Link href={`/races/${discipline}`} className="hover:text-foreground transition-colors capitalize">{discipline}</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{event.name}</span>
            </nav>

            <div className="flex flex-col lg:flex-row gap-8">

              {/* Left: race identity */}
              <div className="flex-1 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{disciplineLabel}</Badge>
                  {event.subDiscipline && (
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      {getSubDisciplineShortLabel(event.subDiscipline)}
                    </Badge>
                  )}
                  {sorted[0]?.race.uciCategory && (
                    <Badge variant="outline">{sorted[0].race.uciCategory}</Badge>
                  )}
                  {new Date(event.date) >= new Date(new Date().toDateString())
                    ? <Badge className="bg-green-500 text-white">Upcoming</Badge>
                    : <Badge variant="secondary">Completed</Badge>}
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-black tracking-tight">{event.name}</h1>
                    <FollowButton followType="race_event" entityId={event.id} entityName={event.name} />
                  </div>
                  <p className="text-muted-foreground mt-1 flex items-center gap-2">
                    {event.country && <span>{countryToFlag(event.country)}</span>}
                    <span>{format(eventDate, "EEEE, MMMM d, yyyy")}</span>
                  </p>
                </div>

                {/* Key facts */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>{eliteRaces.length} elite races</span>
                  {sorted.length > eliteRaces.length && (
                    <span>+ {sorted.length - eliteRaces.length} other categories</span>
                  )}
                  {event.externalLinks?.raceStart && (
                    <span>Start {event.externalLinks.raceStart}</span>
                  )}
                  {event.externalLinks?.raceFinish && (
                    <span>Finish ~{event.externalLinks.raceFinish}</span>
                  )}
                </div>

                {/* Links */}
                {event.externalLinks && Object.keys(event.externalLinks).filter(k => !["tvSchedule","raceStart","raceFinish"].includes(k)).length > 0 && (
                  <RaceLinksSection links={event.externalLinks} />
                )}

                <TelegramSubscribeButton />

                {/* Quick-nav to Men / Women race categories */}
                {sorted.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {sorted.map(({ race }) => {
                      const categorySlug = race.categorySlug ||
                        (race.ageCategory && race.gender ? `${race.ageCategory}-${race.gender}` : null);
                      const href = categorySlug
                        ? `/races/${discipline}/${eventSlug}/${categorySlug}`
                        : `/races/${race.id}`;
                      const label = getCategoryLabel(race.categorySlug, race.ageCategory, race.gender);
                      return (
                        <Link key={race.id} href={href}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                          {label}
                          <span className="opacity-70">→</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right: weather card */}
              {weather && wx && (
                <div className="lg:w-60 shrink-0">
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Race Day Weather</span>
                      <span className="text-xs text-muted-foreground">{weather.city}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-4xl">{wx.emoji}</span>
                      <div>
                        <p className="text-lg font-bold">{weather.tempMax}° / {weather.tempMin}°C</p>
                        <p className="text-sm text-muted-foreground">{wx.desc}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/30">
                      <div className="text-xs">
                        <p className="text-muted-foreground">💧 Rain</p>
                        <p className="font-semibold">{weather.precipMm} mm</p>
                      </div>
                      <div className="text-xs">
                        <p className="text-muted-foreground">💨 Wind</p>
                        <p className="font-semibold">{weather.windKmh} km/h</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── RACE PULSE: Latest News ──────────────────────────────────── */}
        {latestNews.length > 0 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-lg font-bold mb-4">Race Pulse</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {latestNews.map((article) => (
                  <a key={article.id} href={article.url || "#"} target="_blank" rel="noopener noreferrer"
                    className="group flex flex-col rounded-xl border border-border/50 bg-card/30 hover:bg-card/80 hover:border-border transition-all overflow-hidden">
                    {article.imageUrl && (
                      <div className="h-36 overflow-hidden bg-muted/30 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={article.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                    )}
                    <div className="p-3 flex flex-col gap-1.5 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/70">{article.source}</span>
                        {article.publishedAt && (
                          <span className="text-[10px] text-muted-foreground/60">· {formatDistanceToNow(article.publishedAt, { addSuffix: true })}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-snug line-clamp-3 group-hover:text-primary transition-colors">{article.title}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}



        {/* ── FEATURED RACES: Elite Men + Women ───────────────────────── */}
        {eliteRaces.length > 0 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              {(() => {
                const anyCompleted = eliteRaces.some(c => c.race.status === "completed" || c.resultCount > 0);
                const allCompleted = eliteRaces.every(c => c.race.status === "completed" || c.resultCount > 0);
                return (
                  <h2 className="text-lg font-bold mb-4">
                    {allCompleted ? "Results" : anyCompleted ? "Results & Preview" : "Race Preview"}
                  </h2>
                );
              })()}
              <div className={`grid gap-6 ${eliteRaces.length >= 2 ? "lg:grid-cols-2" : ""}`}>
                {eliteRaces.map(({ race, riderCount, resultCount }, idx) => {
                  const topPicks = predictionsPerRace[idx] ?? [];
                  const topResults = resultsPerRace[idx] ?? [];
                  const raceNews = newsPerRace[idx] ?? [];
                  const intel = intelPerRace[idx] ?? [];
                  const categorySlug = race.categorySlug ||
                    (race.ageCategory && race.gender ? generateCategorySlug(race.ageCategory, race.gender) : null);
                  const href = categorySlug ? buildCategoryUrl(discipline, eventSlug, categorySlug) : `/races/${race.id}`;
                  const hasResults = race.status === "completed" || resultCount > 0;
                  const genderLabel = getCategoryLabel(race.categorySlug, race.ageCategory, race.gender);

                  return (
                    <div key={race.id} className="rounded-xl border border-border/50 bg-card/20 overflow-hidden flex flex-col">
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{genderLabel}</span>
                          {riderCount > 0 && (
                            <Badge variant="outline" className="text-xs">{riderCount} riders</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {event.externalLinks?.raceStart && <span>{event.externalLinks.raceStart}</span>}
                          <Badge variant={hasResults ? "secondary" : "default"} className={!hasResults ? "bg-green-500 text-white text-xs" : "text-xs"}>
                            {hasResults ? "Completed" : "Upcoming"}
                          </Badge>
                        </div>
                      </div>

                      <div className="p-4 flex flex-col gap-4 flex-1">
                        {/* Top Results (completed) or Top Contenders (upcoming) */}
                        <div>
                          {hasResults ? (
                            <>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Results</h3>
                              {topResults.length > 0 ? (
                                <div className="space-y-1.5">
                                  {topResults.map(({ result, rider }, i) => (
                                    <div key={rider.id} className="flex items-center gap-2 text-sm">
                                      {i < 3 ? (
                                        rider.photoUrl ? (
                                          <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={rider.photoUrl} alt={rider.name} className="h-full w-full object-cover" />
                                          </div>
                                        ) : (
                                          <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-black ${PODIUM_BADGE[i]}`}>
                                            {rider.name.split(" ").filter(Boolean).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
                                          </div>
                                        )
                                      ) : (
                                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-muted text-muted-foreground">
                                          {i + 1}
                                        </div>
                                      )}
                                      <span className="shrink-0">{countryToFlag(rider.nationality)}</span>
                                      <Link href={`/riders/${rider.id}`} className="font-medium truncate hover:text-primary transition-colors flex-1">
                                        {rider.name}
                                      </Link>
                                      {result.timeSeconds != null && result.position === 1 && (
                                        <span className="text-xs shrink-0 text-muted-foreground font-mono">
                                          {[
                                            Math.floor(result.timeSeconds / 3600),
                                            Math.floor((result.timeSeconds % 3600) / 60),
                                            result.timeSeconds % 60,
                                          ].map(n => String(n).padStart(2, "0")).join(":")}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">Results not yet available</p>
                              )}
                            </>
                          ) : (
                            <>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Top Contenders</h3>
                              {topPicks.length > 0 ? (
                                <div className="space-y-1.5">
                                  {topPicks.map(({ prediction, rider }, i) => (
                                    <div key={rider.id} className="flex items-center gap-2 text-sm">
                                      {i < 3 ? (
                                        rider.photoUrl ? (
                                          <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={rider.photoUrl} alt={rider.name} className="h-full w-full object-cover" />
                                          </div>
                                        ) : (
                                          <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-black ${PODIUM_BADGE[i]}`}>
                                            {rider.name.split(" ").filter(Boolean).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
                                          </div>
                                        )
                                      ) : (
                                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-muted text-muted-foreground">
                                          {i + 1}
                                        </div>
                                      )}
                                      <span className="shrink-0">{countryToFlag(rider.nationality)}</span>
                                      <Link href={`/riders/${rider.id}`} className="font-medium truncate hover:text-primary transition-colors flex-1">
                                        {rider.name}
                                      </Link>
                                      {prediction.winProbability != null && Number(prediction.winProbability) > 0 && (
                                        <span className="text-xs shrink-0 font-semibold tabular-nums text-primary">
                                          {(Number(prediction.winProbability) * 100).toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">Predictions loading...</p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Media Coverage — rider mentions in news */}
                        {(() => {
                          const mentionMap = new Map<string, { rider: typeof topPicks[0]["rider"]; count: number }>();
                          const contenderNames = topPicks.slice(0, 5).map(({ rider }) => ({
                            rider,
                            parts: rider.name.split(/\s+/).filter(p => p.length > 2),
                          }));
                          for (const article of raceNews) {
                            const title = (article.title || "").toLowerCase();
                            for (const { rider, parts } of contenderNames) {
                              if (parts.some(p => title.includes(p.toLowerCase()))) {
                                const existing = mentionMap.get(rider.id);
                                if (existing) existing.count++;
                                else mentionMap.set(rider.id, { rider, count: 1 });
                              }
                            }
                          }
                          const mentions = Array.from(mentionMap.values())
                            .sort((a, b) => b.count - a.count)
                            .slice(0, 3);
                          if (mentions.length === 0) return null;
                          return (
                            <div>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Media Coverage</h3>
                              <div className="space-y-1.5">
                                {mentions.map(({ rider, count }) => (
                                  <div key={rider.id} className="flex items-center gap-2 text-sm">
                                    <span className="shrink-0">{countryToFlag(rider.nationality)}</span>
                                    <Link href={`/riders/${rider.id}`} className="font-medium truncate hover:text-primary transition-colors flex-1">
                                      {rider.name}
                                    </Link>
                                    <span className="text-xs shrink-0 text-muted-foreground">
                                      {count} {count === 1 ? "article" : "articles"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Rider Intel (pre-race only) */}
                        {intel.length > 0 && !hasResults && (
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Rider Intel</h3>
                            <div className="space-y-2">
                              {intel.map(({ rider, rumour }) => {
                                const score = parseFloat(rumour.aggregateScore || "0");
                                const sentiment = score > 0.3
                                  ? { label: "FORM ✓", cls: "bg-green-500/15 text-green-400" }
                                  : score < -0.3
                                  ? { label: "DOUBT", cls: "bg-red-500/15 text-red-400" }
                                  : { label: "INTEL", cls: "bg-muted/50 text-muted-foreground" };
                                return (
                                  <div key={rumour.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20">
                                    <span className="text-sm shrink-0 mt-0.5">{countryToFlag(rider.nationality)}</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        <Link href={`/riders/${rider.id}`} className="text-xs font-semibold hover:text-primary truncate">
                                          {rider.name}
                                        </Link>
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${sentiment.cls}`}>
                                          {sentiment.label}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-muted-foreground line-clamp-2">{rumour.summary}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Latest News (gender-specific) */}
                        {raceNews.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Latest News</h3>
                            <div className="space-y-2">
                              {raceNews.slice(0, 2).map((article) => (
                                <a key={article.id} href={article.url || "#"} target="_blank" rel="noopener noreferrer"
                                  className="flex gap-2.5 items-start hover:bg-muted/30 rounded-lg p-1.5 -m-1.5 transition-colors group">
                                  {article.imageUrl && (
                                    <div className="w-14 h-10 rounded overflow-hidden shrink-0 bg-muted/30">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={article.imageUrl} alt="" className="w-full h-full object-cover" />
                                    </div>
                                  )}
                                  <p className="text-[11px] leading-snug line-clamp-2 group-hover:text-primary transition-colors">{article.title}</p>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* CTA */}
                      <Link href={href}
                        className="flex items-center justify-between px-4 py-3 border-t border-border/30 bg-muted/10 hover:bg-muted/30 transition-colors text-sm font-medium text-primary group">
                        <span>{hasResults ? "Full results & analysis" : "Full analysis, startlist & predictions"}</span>
                        <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── OTHER CATEGORIES ─────────────────────────────────────────── */}
        {otherRaces.length > 0 && (
          <section className="border-b border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-base font-bold mb-4 text-muted-foreground uppercase tracking-wider text-xs">Other categories</h2>
              <div className={`grid gap-6 ${otherRaces.length >= 2 ? "sm:grid-cols-2" : ""} ${otherRaces.length >= 3 ? "lg:grid-cols-2 xl:grid-cols-4" : ""}`}>
                {otherRaces.map(({ race, riderCount, resultCount }, idx) => {
                  const categorySlug = race.categorySlug ||
                    (race.ageCategory && race.gender ? generateCategorySlug(race.ageCategory, race.gender) : null);
                  const href = categorySlug ? buildCategoryUrl(discipline, eventSlug, categorySlug) : `/races/${race.id}`;
                  const hasResults = race.status === "completed" || resultCount > 0;
                  const topResults = otherResultsPerRace[idx] ?? [];
                  const topPicks = otherPredictionsPerRace[idx] ?? [];
                  const categoryLabel = getCategoryLabel(race.categorySlug, race.ageCategory, race.gender);

                  return (
                    <div key={race.id} className="rounded-xl border border-border/50 bg-card/20 overflow-hidden flex flex-col">
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm whitespace-nowrap">{categoryLabel}</span>
                          {riderCount > 0 && (
                            <Badge variant="outline" className="text-xs">{riderCount} riders</Badge>
                          )}
                        </div>
                        <Badge variant={hasResults ? "secondary" : "default"} className={!hasResults ? "bg-green-500 text-white text-xs" : "text-xs"}>
                          {hasResults ? "Completed" : "Upcoming"}
                        </Badge>
                      </div>

                      <div className="p-4 flex-1">
                        {hasResults ? (
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Results</h3>
                            {topResults.length > 0 ? (
                              <div className="space-y-1.5">
                                {topResults.map(({ result, rider }, i) => (
                                  <div key={rider.id} className="flex items-center gap-2 text-sm">
                                    {i < 3 ? (
                                      rider.photoUrl ? (
                                        <div className="h-7 w-7 shrink-0 rounded-full overflow-hidden">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={rider.photoUrl} alt={rider.name} className="h-full w-full object-cover" />
                                        </div>
                                      ) : (
                                        <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${PODIUM_BADGE[i]}`}>
                                          {rider.name.split(" ").filter(Boolean).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
                                        </div>
                                      )
                                    ) : (
                                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-muted text-muted-foreground">
                                        {i + 1}
                                      </div>
                                    )}
                                    <span className="shrink-0">{countryToFlag(rider.nationality)}</span>
                                    <Link href={`/riders/${rider.id}`} className="font-medium truncate hover:text-primary transition-colors flex-1">
                                      {rider.name}
                                    </Link>
                                    {result.timeSeconds != null && result.position === 1 && (
                                      <span className="text-xs shrink-0 text-muted-foreground font-mono">
                                        {[
                                          Math.floor(result.timeSeconds / 3600),
                                          Math.floor((result.timeSeconds % 3600) / 60),
                                          result.timeSeconds % 60,
                                        ].map(n => String(n).padStart(2, "0")).join(":")}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Results not yet available</p>
                            )}
                          </div>
                        ) : (
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Top Contenders</h3>
                            {topPicks.length > 0 ? (
                              <div className="space-y-1.5">
                                {topPicks.map(({ prediction, rider }, i) => (
                                  <div key={rider.id} className="flex items-center gap-2 text-sm">
                                    {i < 3 ? (
                                      rider.photoUrl ? (
                                        <div className="h-7 w-7 shrink-0 rounded-full overflow-hidden">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={rider.photoUrl} alt={rider.name} className="h-full w-full object-cover" />
                                        </div>
                                      ) : (
                                        <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${PODIUM_BADGE[i]}`}>
                                          {rider.name.split(" ").filter(Boolean).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
                                        </div>
                                      )
                                    ) : (
                                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-muted text-muted-foreground">
                                        {i + 1}
                                      </div>
                                    )}
                                    <span className="shrink-0">{countryToFlag(rider.nationality)}</span>
                                    <Link href={`/riders/${rider.id}`} className="font-medium truncate hover:text-primary transition-colors flex-1">
                                      {rider.name}
                                    </Link>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">No predictions yet</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* CTA */}
                      <Link href={href}
                        className="flex items-center justify-between px-4 py-3 border-t border-border/30 bg-muted/10 hover:bg-muted/30 transition-colors text-sm font-medium text-primary group">
                        <span>{hasResults ? "Full results" : "Startlist & predictions"}</span>
                        <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── HOW TO WATCH ─────────────────────────────────────────────── */}
        {event.externalLinks?.tvSchedule && event.externalLinks.tvSchedule.length > 0 && (
          <section className="border-t border-border/50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-6">
              <h2 className="text-lg font-bold mb-4">How to Watch</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {event.externalLinks.tvSchedule.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{entry.region}</p>
                      {entry.url ? (
                        <a href={entry.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-semibold hover:text-primary transition-colors">
                          {entry.channel}
                        </a>
                      ) : (
                        <p className="text-sm font-semibold">{entry.channel}</p>
                      )}
                    </div>
                    {entry.startTime && (
                      <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">{entry.startTime}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── FOLLOW ON WHATSAPP ──────────────────────────────────────── */}
        <section className="border-t border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-8">
            <h2 className="text-lg font-bold mb-4">Follow on WhatsApp</h2>
          </div>
        </section>

      </main>
    </div>
  );
}
