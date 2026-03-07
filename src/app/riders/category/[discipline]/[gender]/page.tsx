import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { db, riders, riderDisciplineStats, teams } from "@/lib/db";
import { desc, eq, ilike, and, asc, sql } from "drizzle-orm";
import { countryFlags } from "@/lib/country-flags";

type Discipline = "road" | "mtb";
type Gender = "men" | "women";
type AgeCategory = "elite" | "junior";

const VALID_DISCIPLINES: Discipline[] = ["road", "mtb"];
const VALID_GENDERS: Gender[] = ["men", "women"];
const VALID_AGE_CATEGORIES: AgeCategory[] = ["elite", "junior"];

interface PageProps {
  params: Promise<{ discipline: string; gender: string }>;
  searchParams: Promise<{ q?: string; country?: string; age?: string }>;
}

type RiderRow = {
  id: string;
  name: string;
  nationality: string | null;
  photoUrl: string | null;
  teamName: string | null;
  teamSlug: string | null;
  currentElo: number;
  winsTotal: number;
  podiumsTotal: number;
  racesTotal: number;
  uciPoints: number;
};

async function getCountries(discipline: Discipline, gender: Gender, ageCategory: AgeCategory): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ nationality: riders.nationality })
      .from(riderDisciplineStats)
      .innerJoin(riders, eq(riderDisciplineStats.riderId, riders.id))
      .where(
        and(
          eq(riderDisciplineStats.discipline, discipline),
          eq(riderDisciplineStats.gender, gender),
          eq(riderDisciplineStats.ageCategory, ageCategory),
          sql`${riders.nationality} IS NOT NULL`
        )
      )
      .orderBy(asc(riders.nationality));
    return rows.map((r) => r.nationality!).filter(Boolean);
  } catch {
    return [];
  }
}

async function getRiders(
  discipline: Discipline,
  gender: Gender,
  ageCategory: AgeCategory,
  q?: string,
  country?: string
): Promise<RiderRow[]> {
  try {
    const conditions = [
      eq(riderDisciplineStats.discipline, discipline),
      eq(riderDisciplineStats.gender, gender),
      eq(riderDisciplineStats.ageCategory, ageCategory),
    ];
    if (country) {
      conditions.push(eq(riders.nationality, country.toUpperCase()));
    }
    if (q) {
      conditions.push(ilike(riders.name, `%${q}%`));
    }

    const results = await db
      .select({
        id: riders.id,
        name: riders.name,
        nationality: riders.nationality,
        photoUrl: riders.photoUrl,
        teamName: teams.name,
        teamSlug: teams.slug,
        currentElo: riderDisciplineStats.currentElo,
        winsTotal: riderDisciplineStats.winsTotal,
        podiumsTotal: riderDisciplineStats.podiumsTotal,
        racesTotal: riderDisciplineStats.racesTotal,
        uciPoints: riderDisciplineStats.uciPoints,
      })
      .from(riderDisciplineStats)
      .innerJoin(riders, eq(riderDisciplineStats.riderId, riders.id))
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(and(...conditions))
      .orderBy(desc(riderDisciplineStats.uciPoints))
      .limit(200);

    return results.map((r) => ({
      ...r,
      currentElo: parseFloat(r.currentElo || "0"),
      winsTotal: r.winsTotal || 0,
      podiumsTotal: r.podiumsTotal || 0,
      racesTotal: r.racesTotal || 0,
      uciPoints: r.uciPoints || 0,
    }));
  } catch {
    return [];
  }
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function getFlag(nat: string | null) {
  if (!nat) return "";
  return countryFlags[nat.toUpperCase()] || nat;
}

const TITLE_MAP: Record<string, Record<string, { title: string; icon: string }>> = {
  road: {
    men: { title: "Road — Men", icon: "🚴" },
    women: { title: "Road — Women", icon: "🚴" },
  },
  mtb: {
    men: { title: "MTB — Men", icon: "🚵" },
    women: { title: "MTB — Women", icon: "🚵" },
  },
};

export default async function CategoryRidersPage({ params, searchParams }: PageProps) {
  const { discipline, gender } = await params;
  const { q, country, age } = await searchParams;

  if (
    !VALID_DISCIPLINES.includes(discipline as Discipline) ||
    !VALID_GENDERS.includes(gender as Gender)
  ) {
    notFound();
  }

  const disc = discipline as Discipline;
  const gen = gender as Gender;
  const ageCategory: AgeCategory = VALID_AGE_CATEGORIES.includes(age as AgeCategory)
    ? (age as AgeCategory)
    : "elite";

  const { title, icon } = TITLE_MAP[disc][gen];

  const [riderRows, countries] = await Promise.all([
    getRiders(disc, gen, ageCategory, q, country),
    getCountries(disc, gen, ageCategory),
  ]);

  // Build base URL (without age param) for tab links
  const baseHref = `/riders/${disc}/${gen}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        {/* Back + heading */}
        <div className="mb-6">
          <Link
            href="/riders"
            className="text-sm text-muted-foreground hover:text-white transition-colors mb-3 inline-flex items-center gap-1"
          >
            ← All riders
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <span>{icon}</span>
                <span>{title}</span>
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {riderRows.length} rider{riderRows.length !== 1 ? "s" : ""} by UCI points
              </p>
            </div>
          </div>
        </div>

        {/* Age category tabs */}
        <div className="flex gap-1 mb-5 border-b border-white/10">
          {VALID_AGE_CATEGORIES.map((cat) => {
            const isActive = cat === ageCategory;
            return (
              <Link
                key={cat}
                href={`${baseHref}?age=${cat}`}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors capitalize ${
                  isActive
                    ? "bg-white/10 text-white border-b-2 border-white"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Link>
            );
          })}
        </div>

        {/* Filters */}
        <form method="GET" className="flex flex-col sm:flex-row gap-3 mb-6">
          {/* Preserve age tab in form submissions */}
          <input type="hidden" name="age" value={ageCategory} />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/20"
          />
          <select
            name="country"
            defaultValue={country ?? ""}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 min-w-[160px]"
          >
            <option value="">All countries</option>
            {countries.map((nat) => (
              <option key={nat} value={nat}>
                {getFlag(nat)} {nat}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-5 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm font-medium transition-colors"
          >
            Filter
          </button>
          {(q || country) && (
            <Link
              href={`${baseHref}?age=${ageCategory}`}
              className="px-5 py-2 text-muted-foreground hover:text-white rounded-lg text-sm font-medium transition-colors border border-white/10 text-center"
            >
              Clear
            </Link>
          )}
        </form>

        {/* Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden bg-white/2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-10">#</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-left">Rider</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-10">Nat</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-left">Team</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">UCI Pts</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-12">W</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-14">Pod</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-16">Races</th>
                </tr>
              </thead>
              <tbody>
                {riderRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      No riders found.
                    </td>
                  </tr>
                ) : (
                  riderRows.map((rider, i) => {
                    const rank = i + 1;
                    const rankStyle =
                      rank === 1
                        ? "text-yellow-400 font-bold"
                        : rank === 2
                          ? "text-gray-300 font-semibold"
                          : rank === 3
                            ? "text-amber-600 font-semibold"
                            : "text-muted-foreground";
                    return (
                      <tr
                        key={rider.id}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                      >
                        <td className={`px-4 py-3 text-sm w-10 text-center ${rankStyle}`}>
                          {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/riders/${rider.id}`}
                            className="flex items-center gap-3 group-hover:text-white transition-colors"
                          >
                            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-white/10 flex items-center justify-center text-xs font-semibold">
                              {rider.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={rider.photoUrl}
                                  alt={rider.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-muted-foreground">{getInitials(rider.name)}</span>
                              )}
                            </div>
                            <span className="font-medium text-sm whitespace-nowrap">{rider.name}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          <span title={rider.nationality || ""}>{getFlag(rider.nationality)}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground max-w-[180px] truncate">
                          {rider.teamSlug ? (
                            <Link
                              href={`/teams/${rider.teamSlug}`}
                              className="hover:text-white transition-colors truncate block"
                            >
                              {rider.teamName}
                            </Link>
                          ) : (
                            <span>{rider.teamName || "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-blue-300">
                          {rider.uciPoints > 0 ? rider.uciPoints.toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-muted-foreground">
                          {rider.winsTotal || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-muted-foreground">
                          {rider.podiumsTotal || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-muted-foreground">
                          {rider.racesTotal || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
