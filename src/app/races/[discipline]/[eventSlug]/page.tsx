import { notFound } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteEventButton } from "@/components/delete-event-button";
import { EventEditDialog } from "@/components/event-edit-dialog";
import { ImportResultsButton } from "@/components/import-results-button";
import { UploadStartlistButton } from "@/components/upload-startlist-button";
import { db, races, raceEvents, raceStartlist, raceResults } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { format } from "date-fns";
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

async function getEventBySlug(discipline: string, slug: string) {
  try {
    const [event] = await db
      .select()
      .from(raceEvents)
      .where(
        and(
          eq(raceEvents.discipline, discipline),
          eq(raceEvents.slug, slug)
        )
      )
      .limit(1);

    return event;
  } catch (error) {
    console.error("Error fetching event:", error);
    return null;
  }
}

async function getEventCategories(eventId: string) {
  try {
    // First get the races
    const eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, eventId))
      .orderBy(races.ageCategory, races.gender);

    // Then get counts for each race
    const categoriesWithCounts = await Promise.all(
      eventRaces.map(async (race) => {
        const [startlistCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(raceStartlist)
          .where(eq(raceStartlist.raceId, race.id));

        const [resultsCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(raceResults)
          .where(eq(raceResults.raceId, race.id));

        return {
          race,
          riderCount: Number(startlistCount?.count) || 0,
          resultCount: Number(resultsCount?.count) || 0,
        };
      })
    );

    return categoriesWithCounts;
  } catch (error) {
    console.error("Error fetching categories:", error);
    return [];
  }
}

// Convert ISO country code to flag emoji
function countryToFlag(countryCode?: string | null) {
  if (!countryCode) return null;
  const code = countryCode.toUpperCase();
  // Convert ISO 3166-1 alpha-2 code to flag emoji
  if (code.length === 2) {
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  // For 3-letter codes, try common mappings
  const alpha3ToAlpha2: Record<string, string> = {
    GER: "DE", USA: "US", RSA: "ZA", GBR: "GB", NED: "NL", DEN: "DK",
    SUI: "CH", AUT: "AT", BEL: "BE", FRA: "FR", ITA: "IT", ESP: "ES",
    POR: "PT", NOR: "NO", SWE: "SE", FIN: "FI", POL: "PL", CZE: "CZ",
    AUS: "AU", NZL: "NZ", JPN: "JP", COL: "CO", ECU: "EC", SLO: "SI",
    CRO: "HR", UKR: "UA", KAZ: "KZ", ERI: "ER", ETH: "ET", RWA: "RW",
  };
  const alpha2 = alpha3ToAlpha2[code] || code.slice(0, 2);
  return String.fromCodePoint(...[...alpha2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export default async function EventPage({ params }: PageProps) {
  const { discipline, eventSlug } = await params;
  const admin = await isAdmin();

  // Validate discipline
  if (!isValidDiscipline(discipline)) {
    notFound();
  }

  // Get event
  const event = await getEventBySlug(discipline, eventSlug);
  if (!event) {
    notFound();
  }

  // Get categories for this event
  const categories = await getEventCategories(event.id);

  const eventDate = new Date(event.date);
  const eventEndDate = event.endDate ? new Date(event.endDate) : null;
  const disciplineLabel = getDisciplineLabel(discipline);

  // Sort categories: Elite first, then U23, then Junior
  const sortedCategories = [...categories].sort((a, b) => {
    const order = { elite: 0, u23: 1, junior: 2, masters: 3 };
    const aOrder = order[a.race.ageCategory as keyof typeof order] ?? 4;
    const bOrder = order[b.race.ageCategory as keyof typeof order] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Then by gender: men first
    return a.race.gender === "men" ? -1 : 1;
  });

  // Use max of startlist or results count (for past events, riders are in results not startlist)
  const totalRiders = categories.reduce((sum, c) => sum + Math.max(Number(c.riderCount), Number(c.resultCount)), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <Link
            href="/races"
            className="text-muted-foreground hover:text-foreground"
          >
            Races
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link
            href={`/races/${discipline}`}
            className="text-muted-foreground hover:text-foreground"
          >
            {disciplineLabel}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{event.name}</span>
        </div>

        {/* Event Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">{disciplineLabel}</Badge>
            {event.subDiscipline && (
              <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">
                {getSubDisciplineShortLabel(event.subDiscipline)}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-bold mb-2">{event.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span>
              {eventEndDate && event.endDate !== event.date
                ? `${format(eventDate, "EEEE, MMMM d")} - ${format(eventEndDate, "MMMM d, yyyy")}`
                : format(eventDate, "EEEE, MMMM d, yyyy")}
            </span>
            {event.country && (
              <span className="flex items-center gap-1">
                {countryToFlag(event.country)} {event.country}
              </span>
            )}
          </div>

          {/* Source link */}
          {event.sourceUrl && (
            <div className="mt-3">
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                View source
              </a>
            </div>
          )}

          {/* Summary stats and actions */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{categories.length} categories</span>
              {totalRiders > 0 && <span>{totalRiders} total riders</span>}
            </div>
            {admin && (
              <div className="flex gap-2">
                <EventEditDialog
                  eventId={event.id}
                  name={event.name}
                  date={event.date}
                  endDate={event.endDate}
                  country={event.country}
                  series={event.series}
                />
                <UploadStartlistButton
                  eventId={event.id}
                  eventName={event.name}
                />
                <ImportResultsButton
                  eventId={event.id}
                  eventName={event.name}
                />
                <DeleteEventButton
                  eventId={event.id}
                  eventName={event.name}
                  redirectTo={`/races/${discipline}`}
                />
              </div>
            )}
          </div>
        </div>

        {/* Categories Grid */}
        {sortedCategories.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedCategories.map(({ race, riderCount, resultCount }) => {
              const categorySlug =
                race.categorySlug ||
                (race.ageCategory && race.gender
                  ? generateCategorySlug(race.ageCategory, race.gender)
                  : null);

              const hasResults = Number(resultCount) > 0;
              const isUpcoming =
                new Date(race.date) > new Date() && !hasResults;

              const href = categorySlug
                ? buildCategoryUrl(discipline, eventSlug, categorySlug)
                : `/races/${race.id}`;

              return (
                <Link key={race.id} href={href}>
                  <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg">
                          {formatCategoryDisplay(
                            race.ageCategory || "elite",
                            race.gender || "men"
                          )}
                        </CardTitle>
                        <Badge
                          variant={hasResults ? "secondary" : "default"}
                          className={isUpcoming ? "bg-green-500 text-white" : ""}
                        >
                          {hasResults ? "Results" : isUpcoming ? "Upcoming" : "Active"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {/* Show results count for past events, startlist count for upcoming */}
                        {hasResults ? (
                          <span>
                            {Number(resultCount)} result{Number(resultCount) !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span>
                            {Number(riderCount)} rider{Number(riderCount) !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 text-sm text-blue-600 dark:text-blue-400">
                        {hasResults ? "View results →" : "View startlist →"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No categories found for this event.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
