/**
 * UCI DataRide Rankings API Client
 *
 * Fetches MTB XCO rankings from the UCI DataRide JSON API at dataride.uci.org.
 * No authentication required. Returns structured data with UCI IDs, birth dates,
 * teams, and nationality — eliminating the need for HTML scraping.
 *
 * API workflow:
 * 1. GET seasons → find current year's disciplineSeasonId
 * 2. POST RankingsDiscipline → discover momentId per category
 * 3. POST ObjectRankings → paginated rider data (pageSize=100)
 */

const BASE_URL = "https://dataride.uci.org/iframe";
const DISCIPLINE_ID = 7; // Mountain Bike
const RACE_TYPE_XCO = 92; // Cross-country Olympic
const RANKING_TYPE_INDIVIDUAL = 1;
const PAGE_SIZE = 100;
const RATE_LIMIT_MS = 500;

let lastRequestTime = 0;

export type UCIRankingCategory = "men_elite" | "women_elite" | "men_junior" | "women_junior";

const CATEGORY_IDS: Record<UCIRankingCategory, number> = {
  men_elite: 22,
  women_elite: 23,
  men_junior: 24,
  women_junior: 25,
};

export interface UCIRankingRider {
  rank: number;
  name: string;             // "BLEVINS Christopher" format
  uciId: string;            // e.g. "10010130319"
  points: number;
  age: number | null;
  birthDate: string | null; // ISO date string "YYYY-MM-DD"
  nationality: string;      // 3-letter UCI code, e.g. "USA"
  countryIso2: string;      // 2-letter ISO code, e.g. "US"
  teamName: string | null;
  teamCode: string | null;
}

interface RankingGroupResponse {
  GroupId: number;
  Rankings: Array<{
    Id: number;        // rankingId
    GroupId: number;
    MomentId: number;
    CategoryId: number;
    RaceTypeId: number;
    RankingTypeId: number;
    TotalObjectRanking: number;
  }>;
}

interface ObjectRankingsResponse {
  data: Array<{
    Rank: number;
    IndividualFullName: string;
    UciId: number;
    Points: number;
    Ages: number;
    BirthDate: string | null;  // .NET date format "/Date(ms)/"
    NationName: string;
    CountryIsoCode2: string;
    TeamName: string | null;
    TeamCode: string | null;
  }>;
  total: number;
}

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, init);
}

/**
 * Parse .NET JSON date format "/Date(1234567890000)/" to ISO date string.
 */
function parseDotNetDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/\/Date\((-?\d+)\)\//);
  if (!match) return null;
  const ms = parseInt(match[1], 10);
  if (isNaN(ms) || ms < 0) return null;
  const d = new Date(ms);
  return d.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

/**
 * Get the current season ID for MTB.
 */
export async function fetchCurrentSeason(): Promise<{ id: number; year: number }> {
  const res = await rateLimitedFetch(
    `${BASE_URL}/GetDisciplineSeasons/?disciplineId=${DISCIPLINE_ID}`
  );
  if (!res.ok) throw new Error(`Failed to fetch seasons: HTTP ${res.status}`);

  const seasons: Array<{ Id: number; Year: number }> = await res.json();
  const currentYear = new Date().getFullYear();

  // Find current year, fall back to most recent
  const season = seasons.find((s) => s.Year === currentYear) ?? seasons[0];
  if (!season) throw new Error("No seasons found");

  return { id: season.Id, year: season.Year };
}

/**
 * Build form-encoded body with Kendo filter syntax.
 */
function buildFilterBody(
  params: Record<string, string | number>,
  filters: Array<{ field: string; value: string | number }>
): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  }
  for (let i = 0; i < filters.length; i++) {
    parts.push(`filter%5Bfilters%5D%5B${i}%5D%5Bfield%5D=${encodeURIComponent(filters[i].field)}`);
    parts.push(`filter%5Bfilters%5D%5B${i}%5D%5Bvalue%5D=${encodeURIComponent(String(filters[i].value))}`);
  }
  return parts.join("&");
}

/**
 * Discover momentId and rankingId for a category by calling RankingsDiscipline.
 */
export async function fetchMomentId(
  seasonId: number,
  categoryId: number
): Promise<{ rankingId: number; momentId: number; total: number }> {
  const body = buildFilterBody(
    {
      disciplineId: DISCIPLINE_ID,
      page: 1,
      pageSize: 40,
      take: 40,
      skip: 0,
    },
    [
      { field: "RaceTypeId", value: RACE_TYPE_XCO },
      { field: "CategoryId", value: categoryId },
      { field: "SeasonId", value: seasonId },
    ]
  );

  const res = await rateLimitedFetch(`${BASE_URL}/RankingsDiscipline/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });

  if (!res.ok) throw new Error(`RankingsDiscipline failed: HTTP ${res.status}`);

  const groups: RankingGroupResponse[] = await res.json();

  // Find the Individual ranking (RankingTypeId=1)
  for (const group of groups) {
    for (const ranking of group.Rankings) {
      if (
        ranking.RankingTypeId === RANKING_TYPE_INDIVIDUAL &&
        ranking.CategoryId === categoryId &&
        ranking.RaceTypeId === RACE_TYPE_XCO
      ) {
        return {
          rankingId: ranking.Id,
          momentId: ranking.MomentId,
          total: ranking.TotalObjectRanking,
        };
      }
    }
  }

  throw new Error(`No individual XCO ranking found for categoryId=${categoryId}`);
}

/**
 * Fetch a page of rankings from ObjectRankings.
 */
async function fetchRankingsPage(
  rankingId: number,
  seasonId: number,
  momentId: number,
  categoryId: number,
  page: number,
  skip: number
): Promise<ObjectRankingsResponse> {
  const body = buildFilterBody(
    {
      rankingId,
      disciplineId: DISCIPLINE_ID,
      rankingTypeId: RANKING_TYPE_INDIVIDUAL,
      page,
      pageSize: PAGE_SIZE,
      take: PAGE_SIZE,
      skip,
    },
    [
      { field: "RaceTypeId", value: RACE_TYPE_XCO },
      { field: "CategoryId", value: categoryId },
      { field: "SeasonId", value: seasonId },
      { field: "MomentId", value: momentId },
      { field: "CountryId", value: 0 },
    ]
  );

  const res = await rateLimitedFetch(`${BASE_URL}/ObjectRankings/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });

  if (!res.ok) throw new Error(`ObjectRankings failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Reorder "LASTNAME Firstname" to "Firstname Lastname" format.
 * The UCI API returns names like "BLEVINS Christopher" — detect by the
 * first word being all uppercase and rearrange to "Christopher Blevins".
 */
function reorderName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;

  // Find where the uppercase last-name part ends.
  // UCI format: "VAN DER POEL Mathieu" — all-caps words are surname.
  let lastUpperIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === parts[i].toUpperCase() && /[A-Z]/.test(parts[i])) {
      lastUpperIdx = i;
    } else {
      break;
    }
  }

  if (lastUpperIdx < 0 || lastUpperIdx >= parts.length - 1) return trimmed;

  const surname = parts.slice(0, lastUpperIdx + 1).join(" ");
  const given = parts.slice(lastUpperIdx + 1).join(" ");
  return `${given} ${surname}`;
}

/**
 * Transform raw API rider data into our normalized format.
 */
function transformRider(raw: ObjectRankingsResponse["data"][number]): UCIRankingRider {
  return {
    rank: raw.Rank,
    name: reorderName(raw.IndividualFullName || ""),
    uciId: raw.UciId ? String(raw.UciId) : "",
    points: raw.Points || 0,
    age: raw.Ages || null,
    birthDate: parseDotNetDate(raw.BirthDate),
    nationality: raw.NationName?.trim() || "",
    countryIso2: raw.CountryIsoCode2?.trim() || "",
    teamName: raw.TeamName?.trim() || null,
    teamCode: raw.TeamCode?.trim() || null,
  };
}

/**
 * Fetch all rankings for a category, handling pagination.
 */
export async function fetchAllUCIRankings(
  category: UCIRankingCategory
): Promise<UCIRankingRider[]> {
  const categoryId = CATEGORY_IDS[category];

  console.log(`[uci-api] Fetching ${category} rankings...`);

  // Step 1: Get current season
  const season = await fetchCurrentSeason();
  console.log(`[uci-api] Season: ${season.year} (id=${season.id})`);

  // Step 2: Discover momentId
  const { rankingId, momentId } = await fetchMomentId(season.id, categoryId);
  console.log(`[uci-api] ${category}: rankingId=${rankingId}, momentId=${momentId}`);

  // Step 3: Paginate through all riders
  // Note: TotalObjectRanking from discovery can be 0 even when riders exist,
  // so we use the `total` from the first ObjectRankings response instead.
  const riders: UCIRankingRider[] = [];
  let page = 1;
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const response = await fetchRankingsPage(
      rankingId,
      season.id,
      momentId,
      categoryId,
      page,
      skip
    );

    // Use actual total from response
    if (total === Infinity) {
      total = response.total || 0;
      console.log(`[uci-api] ${category}: total riders = ${total}`);
    }

    if (!response.data || response.data.length === 0) break;

    for (const raw of response.data) {
      riders.push(transformRider(raw));
    }

    console.log(`[uci-api] ${category}: fetched ${riders.length}/${total} riders`);

    skip += PAGE_SIZE;
    page++;
  }

  console.log(`[uci-api] ${category}: complete — ${riders.length} riders`);
  return riders;
}

/**
 * Find a rider in UCI rankings by UCI ID.
 */
export function findRiderByUciId(
  uciId: string,
  rankings: UCIRankingRider[]
): UCIRankingRider | null {
  return rankings.find((r) => r.uciId === uciId) ?? null;
}

/**
 * Find a rider in UCI rankings by name (normalized fuzzy matching).
 */
export function findRiderByName(
  name: string,
  rankings: UCIRankingRider[]
): UCIRankingRider | null {
  const normalized = normalizeName(name);

  // Exact normalized match
  for (const rider of rankings) {
    if (normalizeName(rider.name) === normalized) return rider;
  }

  // Reversed name parts (handle "Last First" vs "First Last")
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
    for (const rider of rankings) {
      if (normalizeName(rider.name) === reversed) return rider;
    }
  }

  // Partial matching (last name + first name prefix)
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    for (const rider of rankings) {
      const riderNorm = normalizeName(rider.name);
      const riderParts = riderNorm.split(/\s+/);
      if (riderParts.length >= 2) {
        const riderLast = riderParts[riderParts.length - 1];
        const riderFirst = riderParts[0];
        if (
          lastName === riderLast &&
          (firstName === riderFirst ||
            firstName.startsWith(riderFirst.substring(0, 3)) ||
            riderFirst.startsWith(firstName.substring(0, 3)))
        ) {
          return rider;
        }
      }
    }
  }

  return null;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}
