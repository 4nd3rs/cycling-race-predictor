"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isPast, isFuture, isToday } from "date-fns";
import { formatCategoryDisplay } from "@/lib/category-utils";
import { EventEditDialog } from "./event-edit-dialog";
import {
  buildEventUrl,
  buildCategoryUrl,
  generateCategorySlug,
  getSubDisciplineShortLabel,
} from "@/lib/url-utils";

interface RaceCategory {
  id: string;
  ageCategory: string;
  gender: string;
  categorySlug?: string | null;
  riderCount?: number;
}

interface EventCardProps {
  id: string;
  name: string;
  slug?: string | null;
  date: string;
  endDate?: string | null;
  country?: string | null;
  discipline: string;
  subDiscipline?: string | null;
  series?: string | null;
  categories: RaceCategory[];
  className?: string;
}

export function EventCard({
  id,
  name,
  slug,
  date,
  endDate,
  country,
  discipline,
  subDiscipline,
  series,
  categories,
  className,
}: EventCardProps) {
  const startDate = new Date(date);
  const eventEndDate = endDate ? new Date(endDate) : startDate;
  const isUpcoming = isFuture(startDate);
  const isEventToday = isToday(startDate) || isToday(eventEndDate);
  const isCompleted = isPast(eventEndDate);

  const getDisciplineBadge = (disc: string) => {
    if (disc === "road") return { label: "Road", variant: "default" as const };
    if (disc === "mtb") return { label: "MTB", variant: "secondary" as const };
    if (disc === "gravel") return { label: "Gravel", variant: "secondary" as const };
    if (disc === "cyclocross") return { label: "CX", variant: "secondary" as const };
    return { label: disc, variant: "outline" as const };
  };

  // Build event URL using new structure if slug is available
  const eventUrl = slug ? buildEventUrl(discipline, slug) : `/races/${id}`;

  const getStatusBadge = () => {
    if (isEventToday) {
      return (
        <Badge className="bg-red-500 text-white animate-pulse">
          LIVE
        </Badge>
      );
    }
    if (isCompleted) {
      return <Badge variant="secondary">Completed</Badge>;
    }
    if (isUpcoming) {
      return (
        <Badge variant="outline" className="text-green-600 border-green-600">
          {formatDistanceToNow(startDate, { addSuffix: true })}
        </Badge>
      );
    }
    return null;
  };

  const formatDateRange = () => {
    if (endDate && endDate !== date) {
      const start = new Date(date);
      const end = new Date(endDate);
      // Same month
      if (start.getMonth() === end.getMonth()) {
        return `${format(start, "MMM d")}-${format(end, "d, yyyy")}`;
      }
      return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
    }
    return format(startDate, "MMM d, yyyy");
  };

  const disciplineBadge = getDisciplineBadge(discipline);
  const totalRiders = categories.reduce((sum, c) => sum + (c.riderCount || 0), 0);

  // Sort categories: Elite first, then U23, then Junior
  const sortedCategories = [...categories].sort((a, b) => {
    const order = { elite: 0, u23: 1, junior: 2 };
    const aOrder = order[a.ageCategory as keyof typeof order] ?? 3;
    const bOrder = order[b.ageCategory as keyof typeof order] ?? 3;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Then by gender: men first
    return a.gender === "men" ? -1 : 1;
  });

  return (
    <Card
      className={cn(
        "overflow-hidden hover:shadow-md transition-shadow",
        isEventToday && "ring-2 ring-red-500",
        className
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Link href={eventUrl} className="hover:underline">
              <CardTitle className="text-lg">{name}</CardTitle>
            </Link>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              {country && <span>{country}</span>}
              <span>•</span>
              <span>{formatDateRange()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <EventEditDialog
              eventId={id}
              name={name}
              date={date}
              endDate={endDate}
              country={country}
              series={series}
            />
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant={disciplineBadge.variant}>{disciplineBadge.label}</Badge>
          {subDiscipline && (
            <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
              {getSubDisciplineShortLabel(subDiscipline)}
            </Badge>
          )}
        </div>

        {/* Category links */}
        <div className="flex flex-wrap gap-2">
          {sortedCategories.map((cat) => {
            // Build category URL using new structure if event has slug
            const categorySlug = cat.categorySlug || generateCategorySlug(cat.ageCategory, cat.gender);
            const categoryUrl = slug
              ? buildCategoryUrl(discipline, slug, categorySlug)
              : `/races/${cat.id}`;

            return (
              <Link key={cat.id} href={categoryUrl}>
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-muted transition-colors"
                >
                  {formatCategoryDisplay(cat.ageCategory, cat.gender)}
                  {cat.riderCount ? ` (${cat.riderCount})` : ""}
                </Badge>
              </Link>
            );
          })}
        </div>

        {totalRiders > 0 && (
          <div className="pt-2 border-t text-sm text-muted-foreground">
            {totalRiders} total riders
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EventListProps {
  events: Array<{
    id: string;
    name: string;
    slug?: string | null;
    date: string;
    endDate?: string | null;
    country?: string | null;
    discipline: string;
    subDiscipline?: string | null;
    series?: string | null;
    categories: RaceCategory[];
  }>;
  emptyMessage?: string;
}

export function EventList({
  events,
  emptyMessage = "No events found",
}: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {events.map((event) => (
        <EventCard
          key={event.id}
          id={event.id}
          name={event.name}
          slug={event.slug}
          date={event.date}
          endDate={event.endDate}
          country={event.country}
          discipline={event.discipline}
          subDiscipline={event.subDiscipline}
          series={event.series}
          categories={event.categories}
        />
      ))}
    </div>
  );
}
