"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isPast, isFuture, isToday } from "date-fns";

interface RaceCardProps {
  id: string;
  name: string;
  date: string;
  country?: string;
  discipline: string;
  profileType?: string;
  uciCategory?: string;
  status: string;
  riderCount?: number;
  topPrediction?: {
    riderName: string;
    winProbability: number;
  };
  className?: string;
}

export function RaceCard({
  id,
  name,
  date,
  country,
  discipline,
  profileType,
  uciCategory,
  status,
  riderCount,
  topPrediction,
  className,
}: RaceCardProps) {
  const raceDate = new Date(date);
  const isUpcoming = isFuture(raceDate);
  const isRaceToday = isToday(raceDate);
  const isCompleted = status === "completed" || isPast(raceDate);

  const getProfileIcon = (profile?: string) => {
    const icons: Record<string, string> = {
      flat: "➖",
      hilly: "〰️",
      mountain: "⛰️",
      tt: "⏱️",
      cobbles: "🪨",
    };
    return profile ? icons[profile] || "🚴" : "🚴";
  };

  const getDisciplineBadge = (disc: string) => {
    if (disc === "road") return { label: "Road", variant: "default" as const };
    if (disc === "mtb_xco") return { label: "MTB XCO", variant: "secondary" as const };
    if (disc === "mtb_xcc") return { label: "MTB XCC", variant: "secondary" as const };
    return { label: disc, variant: "outline" as const };
  };

  const getStatusBadge = () => {
    if (isRaceToday) {
      return (
        <Badge className="bg-red-500 text-white animate-pulse">
          🔴 TODAY
        </Badge>
      );
    }
    if (isCompleted) {
      return <Badge variant="secondary">Completed</Badge>;
    }
    if (isUpcoming) {
      return (
        <Badge variant="outline" className="text-green-600 border-green-600">
          Upcoming
        </Badge>
      );
    }
    return null;
  };

  const disciplineBadge = getDisciplineBadge(discipline);

  return (
    <Link href={`/races/${id}`}>
      <Card
        className={cn(
          "overflow-hidden hover:shadow-md transition-shadow",
          isRaceToday && "ring-2 ring-red-500",
          className
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{name}</CardTitle>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                {country && <span>{country}</span>}
                <span>•</span>
                <span>
                  {isUpcoming
                    ? formatDistanceToNow(raceDate, { addSuffix: true })
                    : format(raceDate, "MMM d, yyyy")}
                </span>
              </div>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={disciplineBadge.variant}>{disciplineBadge.label}</Badge>
            {profileType && (
              <Badge variant="outline">
                {getProfileIcon(profileType)} {profileType}
              </Badge>
            )}
            {uciCategory && (
              <Badge variant="outline" className="text-xs">
                {uciCategory}
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            {riderCount !== undefined && (
              <span className="text-sm text-muted-foreground">
                {riderCount} riders
              </span>
            )}
            {topPrediction && (
              <div className="text-sm">
                <span className="text-muted-foreground">Favorite: </span>
                <span className="font-medium">{topPrediction.riderName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  ({(topPrediction.winProbability * 100).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface RaceListProps {
  races: Array<{
    id: string;
    name: string;
    date: string;
    country?: string;
    discipline: string;
    profileType?: string;
    uciCategory?: string;
    status: string;
    riderCount?: number;
    topPrediction?: {
      riderName: string;
      winProbability: number;
    };
  }>;
  emptyMessage?: string;
}

export function RaceList({
  races,
  emptyMessage = "No races found",
}: RaceListProps) {
  if (races.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {races.map((race) => (
        <RaceCard
          key={race.id}
          id={race.id}
          name={race.name}
          date={race.date}
          country={race.country}
          discipline={race.discipline}
          profileType={race.profileType}
          uciCategory={race.uciCategory}
          status={race.status}
          riderCount={race.riderCount}
          topPrediction={race.topPrediction}
        />
      ))}
    </div>
  );
}
