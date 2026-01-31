"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface RiderStats {
  discipline: string;
  currentElo: number;
  winsTotal: number;
  podiumsTotal: number;
  racesTotal: number;
  specialty?: string[];
}

interface RiderCardProps {
  id: string;
  name: string;
  nationality?: string;
  photoUrl?: string;
  team?: string;
  age?: number;
  stats?: RiderStats[];
  showLink?: boolean;
  className?: string;
}

export function RiderCard({
  id,
  name,
  nationality,
  photoUrl,
  team,
  age,
  stats,
  showLink = true,
  className,
}: RiderCardProps) {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getEloTier = (elo: number) => {
    if (elo >= 1800) return { label: "Elite", color: "bg-purple-500" };
    if (elo >= 1650) return { label: "Pro", color: "bg-blue-500" };
    if (elo >= 1500) return { label: "Strong", color: "bg-green-500" };
    if (elo >= 1350) return { label: "Average", color: "bg-gray-400" };
    return { label: "Developing", color: "bg-gray-300" };
  };

  const getSpecialtyIcon = (specialty: string) => {
    const icons: Record<string, string> = {
      climber: "⛰️",
      sprinter: "⚡",
      gc: "🏆",
      tt: "⏱️",
      classics: "🏛️",
      puncheur: "💥",
      technical: "🔧",
      power: "💪",
    };
    return icons[specialty.toLowerCase()] || "🚴";
  };

  const content = (
    <Card className={cn("overflow-hidden hover:shadow-md transition-shadow", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={photoUrl} alt={name} />
            <AvatarFallback>{getInitials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{name}</CardTitle>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              {nationality && <span>{nationality}</span>}
              {age && <span>• {age} yrs</span>}
            </div>
            {team && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {team}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      {stats && stats.length > 0 && (
        <CardContent className="pt-0 space-y-3">
          {stats.map((stat) => {
            const eloTier = getEloTier(stat.currentElo);
            return (
              <div key={stat.discipline} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {stat.discipline === "road"
                      ? "Road"
                      : stat.discipline === "mtb_xco"
                        ? "MTB XCO"
                        : stat.discipline === "mtb_xcc"
                          ? "MTB XCC"
                          : stat.discipline}
                  </span>
                  <Badge variant="secondary" className={cn("text-white", eloTier.color)}>
                    {Math.round(stat.currentElo)} ELO
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {stat.winsTotal}
                    </span>{" "}
                    wins
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {stat.podiumsTotal}
                    </span>{" "}
                    podiums
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {stat.racesTotal}
                    </span>{" "}
                    races
                  </span>
                </div>
                {stat.specialty && stat.specialty.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {stat.specialty.map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {getSpecialtyIcon(s)} {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );

  if (showLink) {
    return <Link href={`/riders/${id}`}>{content}</Link>;
  }

  return content;
}

interface RiderListProps {
  riders: Array<{
    id: string;
    name: string;
    nationality?: string;
    photoUrl?: string;
    team?: string;
    age?: number;
    stats?: RiderStats[];
  }>;
}

export function RiderList({ riders }: RiderListProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {riders.map((rider) => (
        <RiderCard
          key={rider.id}
          id={rider.id}
          name={rider.name}
          nationality={rider.nationality}
          photoUrl={rider.photoUrl}
          team={rider.team}
          age={rider.age}
          stats={rider.stats}
        />
      ))}
    </div>
  );
}
