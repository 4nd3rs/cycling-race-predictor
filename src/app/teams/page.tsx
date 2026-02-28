import Link from "next/link";
import { Header } from "@/components/header";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { sql, ilike } from "drizzle-orm";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

type TeamRow = {
  id: string;
  name: string;
  cleanName: string;
  divisionCode: string | null;
  slug: string | null;
  country: string | null;
  riderCount: number;
  totalUciPoints: number;
  topRiderUciPoints: number;
  totalWins: number;
  totalPodiums: number;
  discipline: string;
};

// Parse "(WT)", "(WTW)", "(PRW)" etc. from team names
function parseTeamName(name: string): { cleanName: string; divisionCode: string | null } {
  const match = name.match(/^(.+?)\s*\(([A-Z]+)\)\s*$/);
  if (match) return { cleanName: match[1].trim(), divisionCode: match[2] };
  return { cleanName: name, divisionCode: null };
}

function divisionBadge(code: string | null) {
  if (!code) return null;
  const map: Record<string, { label: string; cls: string }> = {
    WT: { label: "WorldTour", cls: "bg-blue-500/20 text-blue-300" },
    WTW: { label: "WT Women", cls: "bg-pink-500/20 text-pink-300" },
    PT: { label: "ProTeam", cls: "bg-purple-500/20 text-purple-300" },
    PR: { label: "ProTeam", cls: "bg-purple-500/20 text-purple-300" },
    PRW: { label: "ProTeam W", cls: "bg-fuchsia-500/20 text-fuchsia-300" },
    PRT: { label: "ProTeam", cls: "bg-purple-500/20 text-purple-300" },
    CT: { label: "Continental", cls: "bg-gray-500/20 text-gray-300" },
    CTW: { label: "Continental W", cls: "bg-gray-500/20 text-gray-300" },
  };
  const d = map[code];
  if (!d) return { label: code, cls: "bg-gray-500/20 text-gray-300" };
  return d;
}

// 3-letter → 2-letter country code → flag emoji
function countryFlag(code: string | null) {
  if (!code) return "";
  const c = code.toUpperCase();
  const map3to2: Record<string, string> = {
    GER: "DE", USA: "US", RSA: "ZA", GBR: "GB", NED: "NL", DEN: "DK",
    SUI: "CH", AUT: "AT", BEL: "BE", FRA: "FR", ITA: "IT", ESP: "ES",
    POR: "PT", NOR: "NO", SWE: "SE", FIN: "FI", POL: "PL", CZE: "CZ",
    AUS: "AU", NZL: "NZ", JPN: "JP", COL: "CO", ECU: "EC", SLO: "SI",
    CRO: "HR", UKR: "UA", KAZ: "KZ", ERI: "ER", ETH: "ET", RWA: "RW",
    BEL2: "BE", NOR2: "NO", SLK: "SK", LAT: "LV", LTU: "LT", EST: "EE",
  };
  const a2 = c.length === 2 ? c : (map3to2[c] || c.slice(0, 2));
  try {
    return String.fromCodePoint(...[...a2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  } catch {
    return c;
  }
}

function eloColor(elo: number) {
  if (elo >= 1600) return "text-yellow-400";
  if (elo >= 1400) return "text-purple-400";
  if (elo >= 1200) return "text-blue-400";
  if (elo >= 900) return "text-green-400";
  return "text-gray-400";
}

function processRow(raw: {
  id: string;
  name: string;
  slug: string | null;
  country: string | null;
  division: string | null;
  rider_count: number | string;
  total_uci_points: number | string | null;
  top_rider_uci_points: number | string | null;
  total_wins: number | string | null;
  total_podiums: number | string | null;
  discipline?: string;
}): TeamRow {
  const { cleanName, divisionCode } = parseTeamName(raw.name);
  return {
    id: raw.id,
    name: raw.name,
    cleanName,
    divisionCode: raw.division || divisionCode,
    slug: raw.slug,
    country: raw.country,
    riderCount: Number(raw.rider_count) || 0,
    totalUciPoints: Number(raw.total_uci_points) || 0,
    topRiderUciPoints: Number(raw.top_rider_uci_points) || 0,
    totalWins: Number(raw.total_wins) || 0,
    totalPodiums: Number(raw.total_podiums) || 0,
    discipline: (raw as { discipline?: string }).discipline || "road",
  };
}

async function getTopRoadTeams(gender: "men" | "women", limit = 15): Promise<TeamRow[]> {
  try {
    const rows = await db.execute(sql`
      SELECT 
        t.id, t.name, t.slug, t.country, t.division,
        COUNT(DISTINCT r.id)::int AS rider_count,
        COALESCE(SUM(rds.uci_points), 0)::int AS total_uci_points,
        COALESCE(MAX(rds.uci_points), 0)::int AS top_rider_uci_points,
        COALESCE(SUM(rds.wins_total), 0)::int AS total_wins,
        COALESCE(SUM(rds.podiums_total), 0)::int AS total_podiums
      FROM teams t
      INNER JOIN riders r ON r.team_id = t.id
      INNER JOIN rider_discipline_stats rds 
        ON rds.rider_id = r.id 
        AND rds.discipline = 'road' 
        AND rds.gender = ${gender}
      WHERE t.discipline = 'road'
      GROUP BY t.id, t.name, t.slug, t.country, t.division
      HAVING COUNT(DISTINCT r.id) >= 3
      ORDER BY total_uci_points DESC NULLS LAST
      LIMIT ${limit}
    `);
    return (rows.rows as Parameters<typeof processRow>[0][]).map((r) => processRow({ ...r, discipline: "road" }));
  } catch {
    return [];
  }
}

async function getTopMtbTeams(gender: "men" | "women", limit = 15): Promise<TeamRow[]> {
  try {
    const rows = await db.execute(sql`
      SELECT 
        t.id, t.name, t.slug, t.country, t.division,
        COUNT(DISTINCT rds.rider_id)::int AS rider_count,
        COALESCE(SUM(rds.uci_points), 0)::int AS total_uci_points,
        COALESCE(MAX(rds.uci_points), 0)::int AS top_rider_uci_points,
        COALESCE(SUM(rds.wins_total), 0)::int AS total_wins,
        COALESCE(SUM(rds.podiums_total), 0)::int AS total_podiums
      FROM teams t
      INNER JOIN rider_discipline_stats rds 
        ON rds.team_id = t.id 
        AND rds.discipline = 'mtb'
        AND rds.gender = ${gender}
      WHERE t.discipline = 'mtb'
      GROUP BY t.id, t.name, t.slug, t.country, t.division
      HAVING COUNT(DISTINCT rds.rider_id) >= 3
      ORDER BY total_uci_points DESC NULLS LAST
      LIMIT ${limit}
    `);
    return (rows.rows as Parameters<typeof processRow>[0][]).map((r) => processRow({ ...r, discipline: "mtb" }));
  } catch {
    return [];
  }
}

async function searchTeams(query: string): Promise<TeamRow[]> {
  try {
    // Road teams
    const road = await db.execute(sql`
      SELECT 
        t.id, t.name, t.slug, t.country, t.division, 'road' AS discipline,
        COUNT(DISTINCT r.id)::int AS rider_count,
        COALESCE(SUM(rds.uci_points), 0)::int AS total_uci_points,
        COALESCE(MAX(rds.uci_points), 0)::int AS top_rider_uci_points,
        COALESCE(SUM(rds.wins_total), 0)::int AS total_wins,
        COALESCE(SUM(rds.podiums_total), 0)::int AS total_podiums
      FROM teams t
      LEFT JOIN riders r ON r.team_id = t.id
      LEFT JOIN rider_discipline_stats rds ON rds.rider_id = r.id AND rds.discipline = 'road'
      WHERE t.discipline = 'road' AND t.name ILIKE ${'%' + query + '%'}
      GROUP BY t.id, t.name, t.slug, t.country, t.division
      ORDER BY total_uci_points DESC NULLS LAST
      LIMIT 30
    `);
    // MTB teams
    const mtb = await db.execute(sql`
      SELECT 
        t.id, t.name, t.slug, t.country, t.division, 'mtb' AS discipline,
        COUNT(DISTINCT rds.rider_id)::int AS rider_count,
        COALESCE(SUM(rds.uci_points), 0)::int AS total_uci_points,
        COALESCE(MAX(rds.uci_points), 0)::int AS top_rider_uci_points,
        COALESCE(SUM(rds.wins_total), 0)::int AS total_wins,
        COALESCE(SUM(rds.podiums_total), 0)::int AS total_podiums
      FROM teams t
      LEFT JOIN rider_discipline_stats rds ON rds.team_id = t.id AND rds.discipline = 'mtb'
      WHERE t.discipline = 'mtb' AND t.name ILIKE ${'%' + query + '%'}
      GROUP BY t.id, t.name, t.slug, t.country, t.division
      HAVING COUNT(DISTINCT rds.rider_id) >= 1
      ORDER BY total_uci_points DESC NULLS LAST
      LIMIT 30
    `);
    const combined = [
      ...(road.rows as Parameters<typeof processRow>[0][]).map((r) => processRow(r)),
      ...(mtb.rows as Parameters<typeof processRow>[0][]).map((r) => processRow(r)),
    ];
    combined.sort((a, b) => b.totalUciPoints - a.totalUciPoints);
    return combined.slice(0, 60);
  } catch {
    return [];
  }
}

function TeamTableRow({ team, rank }: { team: TeamRow; rank: number }) {
  const rankStyle =
    rank === 1
      ? "text-yellow-400 font-bold"
      : rank === 2
        ? "text-gray-300 font-semibold"
        : rank === 3
          ? "text-amber-600 font-semibold"
          : "text-muted-foreground";

  const badge = divisionBadge(team.divisionCode);
  const href = team.slug ? `/teams/${team.slug}` : `/teams/${team.id}`;
  const flag = countryFlag(team.country);

  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors group">
      {/* Rank */}
      <td className={`pl-4 pr-2 py-3 text-sm w-8 text-center shrink-0 ${rankStyle}`}>
        {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
      </td>
      {/* Team name */}
      <td className="px-2 py-3 w-full">
        <Link href={href} className="flex items-center gap-2.5 group-hover:text-white transition-colors min-w-0">
          <div className="w-7 h-7 rounded-md shrink-0 bg-white/10 flex items-center justify-center text-[9px] font-black text-white/60">
            {team.cleanName
              .split(/[\s\-|]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() || "")
              .join("")}
          </div>
          <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm truncate">{team.cleanName}</span>
            {flag && <span className="text-sm shrink-0">{flag}</span>}
            {badge && (
              <span className={`text-[9px] px-1 py-0.5 rounded font-semibold shrink-0 ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>
        </Link>
      </td>
      {/* Riders */}
      <td className="px-3 py-3 text-sm text-center text-muted-foreground w-14 shrink-0 whitespace-nowrap">
        {team.riderCount || "—"}
      </td>
      {/* UCI Points */}
      <td className="pl-3 pr-4 py-3 text-sm text-right font-mono font-semibold w-20 shrink-0 whitespace-nowrap text-blue-300">
        {team.totalUciPoints > 0 ? team.totalUciPoints.toLocaleString() : "—"}
      </td>
    </tr>
  );
}

function TeamTable({
  title,
  icon,
  teams,
}: {
  title: string;
  icon: string;
  teams: TeamRow[];
}) {
  if (teams.length === 0) return null;
  return (
    <div className="mb-10">
      <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
        <span>{icon}</span>
        <span>{title}</span>
        <span className="text-xs text-muted-foreground font-normal ml-1">by UCI points</span>
      </h2>
      <div className="rounded-xl border border-white/10 overflow-hidden bg-white/2">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="pl-4 pr-2 py-2.5 text-xs font-medium text-muted-foreground text-center w-8">#</th>
              <th className="px-2 py-2.5 text-xs font-medium text-muted-foreground text-left">Team</th>
              <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground text-center w-14 whitespace-nowrap">Riders</th>
              <th className="pl-3 pr-4 py-2.5 text-xs font-medium text-muted-foreground text-right w-20 whitespace-nowrap">UCI Pts</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, i) => (
              <TeamTableRow key={team.id} team={team} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function TeamsPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  if (q) {
    const results = await searchTeams(q);
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold">Teams</h1>
              <p className="text-muted-foreground mt-1">
                {results.length} results for &ldquo;{q}&rdquo;
              </p>
            </div>
          </div>

          <form className="mb-8 max-w-md">
            <Input type="search" name="q" placeholder="Search teams..." defaultValue={q} />
          </form>

          <TeamTable title="Search results" icon="🔍" teams={results} />
        </main>
      </div>
    );
  }

  const [roadMen, roadWomen, mtbMen, mtbWomen] = await Promise.all([
    getTopRoadTeams("men", 15),
    getTopRoadTeams("women", 15),
    getTopMtbTeams("men", 15),
    getTopMtbTeams("women", 15),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Teams</h1>
            <p className="text-muted-foreground mt-1">
              Top teams ranked by total UCI points
            </p>
          </div>
          <form className="w-full md:w-72">
            <Input type="search" name="q" placeholder="Search teams..." />
          </form>
        </div>

        {/* 2-column grid: Road left, MTB right */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8">
          <div>
            <TeamTable title="Road — Men" icon="🚴" teams={roadMen} />
            <TeamTable title="Road — Women" icon="🚴" teams={roadWomen} />
          </div>
          <div>
            <TeamTable title="MTB — Men" icon="🚵" teams={mtbMen} />
            <TeamTable title="MTB — Women" icon="🚵" teams={mtbWomen} />
          </div>
        </div>
      </main>
    </div>
  );
}
