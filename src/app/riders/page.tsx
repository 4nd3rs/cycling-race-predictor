import Link from "next/link";
import { Header } from "@/components/header";
import { Input } from "@/components/ui/input";
import { db, riders, riderDisciplineStats, teams } from "@/lib/db";
import { desc, eq, ilike, and } from "drizzle-orm";
import { countryFlags } from "@/lib/country-flags";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
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
  discipline: string;
  gender: string | null;
  uciPoints: number;
};

async function getTopByCategory(
  discipline: "road" | "mtb",
  gender: "men" | "women",
  limit = 10
): Promise<RiderRow[]> {
  try {
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
        discipline: riderDisciplineStats.discipline,
        gender: riderDisciplineStats.gender,
        uciPoints: riderDisciplineStats.uciPoints,
      })
      .from(riderDisciplineStats)
      .innerJoin(riders, eq(riderDisciplineStats.riderId, riders.id))
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(
        and(
          eq(riderDisciplineStats.discipline, discipline),
          eq(riderDisciplineStats.gender, gender)
        )
      )
      .orderBy(desc(riderDisciplineStats.uciPoints))
      .limit(limit);

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

async function searchRiders(query: string): Promise<RiderRow[]> {
  try {
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
        discipline: riderDisciplineStats.discipline,
        gender: riderDisciplineStats.gender,
        uciPoints: riderDisciplineStats.uciPoints,
      })
      .from(riders)
      .leftJoin(
        riderDisciplineStats,
        eq(riders.id, riderDisciplineStats.riderId)
      )
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(ilike(riders.name, `%${query}%`))
      .orderBy(desc(riderDisciplineStats.uciPoints))
      .limit(60);

    return results.map((r) => ({
      ...r,
      currentElo: parseFloat(r.currentElo || "0"),
      winsTotal: r.winsTotal || 0,
      podiumsTotal: r.podiumsTotal || 0,
      racesTotal: r.racesTotal || 0,
      discipline: r.discipline || "—",
      gender: r.gender || "—",
      uciPoints: r.uciPoints || 0,
    }));
  } catch {
    return [];
  }
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getFlag(nat: string | null) {
  if (!nat) return "";
  return countryFlags[nat.toUpperCase()] || nat;
}

function eloColor(elo: number) {
  if (elo >= 1600) return "text-yellow-400";
  if (elo >= 1400) return "text-purple-400";
  if (elo >= 1200) return "text-blue-400";
  if (elo >= 900) return "text-green-400";
  return "text-gray-400";
}

function RiderTableRow({
  rider,
  rank,
  showDiscipline = false,
}: {
  rider: RiderRow;
  rank: number;
  showDiscipline?: boolean;
}) {
  const rankStyle =
    rank === 1
      ? "text-yellow-400 font-bold"
      : rank === 2
        ? "text-gray-300 font-semibold"
        : rank === 3
          ? "text-amber-600 font-semibold"
          : "text-muted-foreground";

  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors group">
      <td className={`px-4 py-3 text-sm w-10 text-center ${rankStyle}`}>
        {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/riders/${rider.id}`}
          className="flex items-center gap-3 group-hover:text-white transition-colors"
        >
          {/* Avatar */}
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
          <span className="font-medium text-sm">{rider.name}</span>
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-center">
        <span title={rider.nationality || ""}>{getFlag(rider.nationality)}</span>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[160px] truncate">
        {rider.teamSlug ? (
          <Link href={`/teams/${rider.teamSlug}`} className="hover:text-white transition-colors truncate block">
            {rider.teamName}
          </Link>
        ) : (
          <span>{rider.teamName || "—"}</span>
        )}
      </td>
      {showDiscipline && (
        <td className="px-4 py-3 text-xs text-center">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rider.discipline === "road" ? "bg-blue-500/20 text-blue-300" : "bg-green-500/20 text-green-300"}`}>
            {rider.discipline === "road" ? "Road" : "MTB"}
            {" "}
            {rider.gender === "men" ? "♂" : "♀"}
          </span>
        </td>
      )}
      <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-blue-300">
        {rider.uciPoints > 0 ? rider.uciPoints.toLocaleString() : "—"}
      </td>
      <td className="px-4 py-3 text-sm text-center text-muted-foreground">
        {rider.winsTotal || "—"}
      </td>
      <td className="px-4 py-3 text-sm text-center text-muted-foreground">
        {rider.podiumsTotal || "—"}
      </td>
      <td className="px-4 py-3 text-sm text-center text-muted-foreground hidden md:table-cell">
        {rider.racesTotal || "—"}
      </td>
    </tr>
  );
}

function RiderTable({
  title,
  icon,
  riders,
  showDiscipline = false,
  viewAllHref,
}: {
  title: string;
  icon: string;
  riders: RiderRow[];
  showDiscipline?: boolean;
  viewAllHref?: string;
}) {
  if (riders.length === 0) return null;
  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span>{icon}</span>
          <span>{title}</span>
          <span className="text-xs text-muted-foreground font-normal ml-1">by UCI points</span>
        </h2>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs text-muted-foreground hover:text-white transition-colors flex items-center gap-1"
          >
            View all →
          </Link>
        )}
      </div>
      <div className="rounded-xl border border-white/10 overflow-hidden bg-white/2">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-10">#</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-left">Rider</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-10">Nat</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-left">Team</th>
              {showDiscipline && (
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center">Cat</th>
              )}
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">UCI Pts</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-12">W</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-12">Pod</th>
              <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center w-14 hidden md:table-cell">Races</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((rider, i) => (
              <RiderTableRow
                key={rider.id}
                rider={rider}
                rank={i + 1}
                showDiscipline={showDiscipline}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

export default async function RidersPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  if (q) {
    const results = await searchRiders(q);
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold">Riders</h1>
              <p className="text-muted-foreground mt-1">
                {results.length} results for &ldquo;{q}&rdquo;
              </p>
            </div>
          </div>

          <form className="mb-8 max-w-md">
            <Input type="search" name="q" placeholder="Search riders..." defaultValue={q} />
          </form>

          <RiderTable
            title={`Search results`}
            icon="🔍"
            riders={results}
            showDiscipline
          />
        </main>
      </div>
    );
  }

  // Fetch all 4 categories in parallel
  const [roadMen, roadWomen, mtbMen, mtbWomen] = await Promise.all([
    getTopByCategory("road", "men", 10),
    getTopByCategory("road", "women", 10),
    getTopByCategory("mtb", "men", 10),
    getTopByCategory("mtb", "women", 10),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Riders</h1>
            <p className="text-muted-foreground mt-1">
              Top ranked professional cyclists by UCI points
            </p>
          </div>
          <form className="w-full md:w-72">
            <Input type="search" name="q" placeholder="Search riders..." />
          </form>
        </div>

        {/* 2-column grid: Road left, MTB right */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8">
          <div>
            <RiderTable title="Road — Men" icon="🚴" riders={roadMen} viewAllHref="/riders/category/road/men" />
            <RiderTable title="Road — Women" icon="🚴" riders={roadWomen} viewAllHref="/riders/category/road/women" />
          </div>
          <div>
            <RiderTable title="MTB — Men" icon="🚵" riders={mtbMen} viewAllHref="/riders/category/mtb/men" />
            <RiderTable title="MTB — Women" icon="🚵" riders={mtbWomen} viewAllHref="/riders/category/mtb/women" />
          </div>
        </div>
      </main>
    </div>
  );
}
