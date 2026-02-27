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
import { getFlag } from "@/lib/country-flags";


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
  uciCategory?: string | null;
  externalLinks?: {
    website?: string;
    twitter?: string;
    instagram?: string;
    youtube?: string;
    liveStream?: Array<{ name: string; url: string; free?: boolean }>;
    tracking?: string;
  } | null;
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
    uciCategory?: string | null;
    externalLinks?: {
      website?: string;
      twitter?: string;
      instagram?: string;
      youtube?: string;
      liveStream?: Array<{ name: string; url: string; free?: boolean }>;
      tracking?: string;
    } | null;
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

// ─── List row variant ────────────────────────────────────────────────────────

function catAbbr(ageCategory: string, gender: string): string {
  const age = { elite: "E", u23: "U23", junior: "J", masters: "M" }[ageCategory] ?? ageCategory.toUpperCase().slice(0, 2);
  const g = gender === "men" ? "M" : "W";
  return `${age}${g}`;
}

const DISC_COLORS: Record<string, string> = {
  road:       "bg-red-500/20 text-red-400 border border-red-500/30",
  mtb:        "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  gravel:     "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cyclocross: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
};

// ── Small SVG icons for link row ─────────────────────────────────────────────
function LinkIcon({ href, title, className, children }: { href: string; title: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      className={cn("text-muted-foreground/60 hover:text-foreground transition-colors", className)}
      onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

export function EventListRow({
  id, name, slug, date, endDate, country, discipline, subDiscipline,
  uciCategory, externalLinks, categories,
}: EventCardProps) {
  const startDate = new Date(date + "T12:00:00");
  const isEventToday = isToday(startDate);
  const isCompleted = isPast(new Date((endDate ?? date) + "T23:59:59"));

  const eventUrl = slug ? buildEventUrl(discipline, slug) : `/races/${id}`;

  const dateStr = format(startDate, "MMM d");
  const discColor = DISC_COLORS[discipline] ?? "bg-zinc-500/20 text-zinc-400";
  const discLabel = { road: "Road", mtb: "MTB", gravel: "Gravel", cyclocross: "CX" }[discipline] ?? discipline;

  const sortedCats = [...categories].sort((a, b) => {
    const o = { elite: 0, u23: 1, junior: 2, masters: 3 };
    const ao = o[a.ageCategory as keyof typeof o] ?? 4;
    const bo = o[b.ageCategory as keyof typeof o] ?? 4;
    return ao !== bo ? ao - bo : (a.gender === "men" ? -1 : 1);
  });

  const totalRiders = categories.reduce((s, c) => s + (c.riderCount || 0), 0);

  const statusEl = isEventToday ? (
    <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white animate-pulse">LIVE</span>
  ) : isCompleted ? (
    <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground bg-muted/40">Done</span>
  ) : (
    <span className="rounded px-1.5 py-0.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 whitespace-nowrap">
      {formatDistanceToNow(startDate, { addSuffix: true })}
    </span>
  );

  return (
    <div className={cn(
      "flex items-center gap-3 py-2.5 px-3 border-b border-border/30 hover:bg-muted/20 transition-colors group",
      isEventToday && "bg-red-500/5 border-l-2 border-l-red-500"
    )}>
      {/* Date */}
      <span className="w-12 shrink-0 text-xs font-mono text-muted-foreground tabular-nums">{dateStr}</span>

      {/* Discipline + UCI category */}
      <div className="hidden sm:flex items-center gap-1 shrink-0 w-28">
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", discColor)}>
          {subDiscipline ? getSubDisciplineShortLabel(subDiscipline) : discLabel}
        </span>
        {uciCategory && (
          <span className="text-[10px] text-muted-foreground/70 font-mono truncate">{uciCategory}</span>
        )}
      </div>

      {/* Name + Country flag */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {country && <span className="text-base shrink-0 leading-none">{getFlag(country)}</span>}
        <Link href={eventUrl} className="font-medium text-sm hover:text-primary transition-colors truncate">
          {name}
        </Link>
      </div>



      {/* Category pills */}
      <div className="hidden md:flex items-center gap-1 shrink-0">
        {sortedCats.slice(0, 5).map((c) => (
          <span key={c.id} className="rounded px-1 py-0.5 text-[10px] bg-muted/50 text-muted-foreground font-mono">
            {catAbbr(c.ageCategory, c.gender)}
          </span>
        ))}
        {sortedCats.length > 5 && (
          <span className="text-[10px] text-muted-foreground">+{sortedCats.length - 5}</span>
        )}
      </div>

      {/* Riders count */}
      <span className="hidden lg:block text-xs text-muted-foreground shrink-0 w-14 text-right tabular-nums">
        {totalRiders > 0 ? `${totalRiders}` : ""}
      </span>



      {/* Status */}
      <div className="shrink-0">{statusEl}</div>
    </div>
  );
}

export function EventListView({
  events,
  emptyMessage = "No events found",
}: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">{emptyMessage}</div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 py-2 px-3 bg-muted/30 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <span className="w-12 shrink-0">Date</span>
        <span className="hidden sm:block w-28 shrink-0">Type</span>
        <span className="flex-1">Event</span>
        <span className="hidden md:block w-24">Categories</span>
        <span className="hidden lg:block w-14 text-right">Riders</span>
        <span className="w-20 text-right">Status</span>
      </div>
      {events.map((event) => (
        <EventListRow
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
          uciCategory={event.uciCategory}
          externalLinks={event.externalLinks}
          categories={event.categories}
        />
      ))}
    </div>
  );
}
