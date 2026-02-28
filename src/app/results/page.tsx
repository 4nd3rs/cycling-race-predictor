import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { db, races, raceEvents, raceResults, riders } from "@/lib/db";
import { eq, and, lt, desc, inArray, isNotNull } from "drizzle-orm";
import { format } from "date-fns";
import { toRaceDate } from "@/lib/utils";
import { getFlag } from "@/lib/country-flags";
import { buildEventUrl, normalizeUciCategory, getDisciplineColor, VALID_DISCIPLINES, type Discipline } from "@/lib/url-utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PodiumRider {
  position: number;
  name: string;
}

interface ResultRow {
  raceId: string;
  raceName: string | null;
  raceDate: string;
  raceGender: string;
  raceAgeCategory: string;
  raceUciCategory: string | null;
  eventSlug: string;
  eventName: string;
  eventCountry: string | null;
  eventDiscipline: string;
  podium: PodiumRider[];
}

async function getResults(
  discipline: string | null,
  gender: string | null,
  cat: string | null
): Promise<ResultRow[]> {
  const today = new Date().toISOString().split("T")[0];

  try {
    const rows = await db
      .select({
        race: races,
        event: raceEvents,
        result: raceResults,
        rider: { id: riders.id, name: riders.name },
      })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(
        and(
          lt(races.date, today),
          inArray(raceResults.position, [1, 2, 3]),
          isNotNull(raceEvents.slug)
        )
      )
      .orderBy(desc(races.date), raceResults.position)
      .limit(500);

    const raceMap = new Map<string, ResultRow>();
    for (const { race, event, result, rider } of rows) {
      if (discipline && discipline !== "all" && event.discipline !== discipline) continue;
      if (gender && gender !== "all" && race.gender !== gender) continue;
      if (cat && cat !== "all") {
        const [catAge, catGender] = cat.split("-");
        if ((race.ageCategory || "elite") !== catAge) continue;
        if ((race.gender || "men") !== catGender) continue;
      }

      if (!raceMap.has(race.id)) {
        raceMap.set(race.id, {
          raceId: race.id,
          raceName: race.name,
          raceDate: race.date,
          raceGender: race.gender || "men",
          raceAgeCategory: race.ageCategory || "elite",
          raceUciCategory: race.uciCategory ?? null,
          eventSlug: event.slug!,
          eventName: event.name,
          eventCountry: event.country,
          eventDiscipline: event.discipline,
          podium: [],
        });
      }

      const row = raceMap.get(race.id)!;
      if (row.podium.length < 3) {
        row.podium.push({ position: result.position ?? 0, name: rider.name });
      }
    }

    return Array.from(raceMap.values())
      .sort((a, b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime())
      .slice(0, 60);
  } catch (e) {
    console.error(e);
    return [];
  }
}

function getGenderLabel(gender: string, ageCategory: string): string {
  const g = gender === "women" ? "F" : "M";
  if (ageCategory === "junior") return `${g}J`;
  if (ageCategory === "u23") return `${g}U23`;
  return g;
}

function FilterPills({ discipline, gender, cat }: { discipline: string; gender: string; cat: string }) {
  const buildHref = (d: string, g: string, c: string) => {
    const params = new URLSearchParams();
    if (d !== "all") params.set("d", d);
    if (g !== "all") params.set("gender", g);
    if (c !== "all") params.set("cat", c);
    const qs = params.toString();
    return `/results${qs ? `?${qs}` : ""}`;
  };

  const disciplines = [
    { value: "all", label: "All" },
    { value: "road", label: "Road" },
    { value: "mtb", label: "MTB" },
    { value: "gravel", label: "Gravel" },
    { value: "cyclocross", label: "CX" },
  ];

  const genders = [
    { value: "all", label: "All" },
    { value: "men", label: "Men" },
    { value: "women", label: "Women" },
  ];

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <div className="flex flex-wrap gap-1">
        {disciplines.map((d) => (
          <Link
            key={d.value}
            href={buildHref(d.value, gender, cat)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-full border transition-colors",
              discipline === d.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {d.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {genders.map((g) => (
          <Link
            key={g.value}
            href={buildHref(discipline, g.value, cat)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-full border transition-colors",
              gender === g.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {g.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ResultRowItem({ row }: { row: ResultRow }) {
  const eventUrl = buildEventUrl(row.eventDiscipline, row.eventSlug);
  const dateStr = format(toRaceDate(row.raceDate), "MMM d");
  const genderLabel = getGenderLabel(row.raceGender, row.raceAgeCategory);
  const [p1, p2, p3] = row.podium;

  return (
    <div className="flex items-start gap-3 py-3 px-3 border-b border-border/30 last:border-0 hover:bg-white/[0.03] transition-colors">
      <span className="text-xs text-muted-foreground w-12 shrink-0 pt-0.5">{dateStr}</span>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm shrink-0">{getFlag(row.eventCountry)}</span>
          <Link
            href={eventUrl}
            className="text-sm font-semibold hover:text-primary transition-colors truncate"
          >
            {row.eventName}
            {row.raceName && row.raceName !== row.eventName && (
              <span className="text-muted-foreground font-normal"> — {row.raceName}</span>
            )}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {p1 && (
            <span>
              <span className="text-foreground/60 font-medium mr-1">1.</span>
              <span className="text-foreground">{p1.name}</span>
            </span>
          )}
          {p2 && (
            <span className="hidden sm:inline">
              <span className="text-foreground/60 font-medium mr-1">2.</span>
              {p2.name}
            </span>
          )}
          {p3 && (
            <span className="hidden sm:inline">
              <span className="text-foreground/60 font-medium mr-1">3.</span>
              {p3.name}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant="outline" className={cn("text-[10px] font-medium", getDisciplineColor(row.eventDiscipline))}>
          {row.eventDiscipline.toUpperCase().slice(0, 4)}
          {row.raceUciCategory ? ` ${normalizeUciCategory(row.raceUciCategory)}` : ""}
        </Badge>
        <span className="text-[10px] font-mono font-semibold text-muted-foreground border border-border/50 rounded px-1.5 py-0.5">
          {genderLabel}
        </span>
      </div>
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{ d?: string; gender?: string; cat?: string }>;
}

export default async function ResultsPage({ searchParams }: PageProps) {
  const { d, gender: genderParam, cat: catParam } = await searchParams;

  const discipline = VALID_DISCIPLINES.includes(d as Discipline) ? (d as string) : "all";
  const gender = ["men", "women"].includes(genderParam || "") ? genderParam! : "all";
  const cat = catParam || "all";

  const results = await getResults(
    discipline === "all" ? null : discipline,
    gender === "all" ? null : gender,
    cat === "all" ? null : cat
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">

        <div className="mb-6">
          <h1 className="text-3xl font-bold">Results</h1>
          <p className="text-muted-foreground mt-1 text-sm">Recent race results</p>
        </div>

        <FilterPills discipline={discipline} gender={gender} cat={cat} />

        {results.length > 0 ? (
          <div className="rounded-lg border border-border/50 overflow-hidden">
            {results.map((row) => (
              <ResultRowItem key={row.raceId} row={row} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 py-16 text-center">
            <p className="text-muted-foreground text-sm">No results found for the selected filters.</p>
          </div>
        )}

      </main>
    </div>
  );
}
