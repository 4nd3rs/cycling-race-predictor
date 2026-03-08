/**
 * Shared Timing Adapters for MTB Results & Startlists
 *
 * Extracts results and startlists from timing platforms:
 * - sportstiming.dk
 * - my.raceresult.com
 * - live.eqtiming.com
 */

import * as cheerio from "cheerio";

// ─── Shared types ────────────────────────────────────────────────────────────

export interface TimingRaceResult {
  position: number | null;
  riderName: string;
  nationality?: string;
  team?: string;
  timeSeconds: number | null;
  dnf: boolean;
  dns: boolean;
  categoryName: string;
}

export interface StartlistEntry {
  riderName: string;
  bibNumber?: number;
  nationality?: string;
  team?: string;
  categoryName: string;
}

export interface CategoryMatch {
  ageCategory: "elite" | "u23" | "junior";
  gender: "men" | "women";
}

// ─── Category classifier ──────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<{ re: RegExp; match: CategoryMatch }> = [
  // IMPORTANT: Women patterns MUST come before men patterns to avoid "man" matching inside "woman"

  // Junior Series (French RaceResult format) — must come before generic junior
  { re: /junior\s+series\b.*\b(?:femme|woman|fille)\b/i, match: { ageCategory: "junior", gender: "women" } },
  { re: /junior\s+series\b.*\b(?:homme|\bman\b|garçon)\b/i, match: { ageCategory: "junior", gender: "men" } },

  // Elite women — multi-language
  { re: /elite.*(wom[ae]n|dam|kvind|ladies|femme|femenin|frauen|donne)/i, match: { ageCategory: "elite", gender: "women" } },
  { re: /(?:wom[ae]n|femme|femenin|frauen|donne).*elite/i, match: { ageCategory: "elite", gender: "women" } },
  { re: /damer.*elite/i, match: { ageCategory: "elite", gender: "women" } },
  // Elite men — multi-language (use \bman\b to avoid matching "woman")
  { re: /elite.*(?:\bmen\b|herr|herre|mænd|\bman\b|homme|masculin|männer|uomini)/i, match: { ageCategory: "elite", gender: "men" } },
  { re: /(?:\bmen\b|homme|masculin|männer).*elite/i, match: { ageCategory: "elite", gender: "men" } },
  { re: /herrer.*elite/i, match: { ageCategory: "elite", gender: "men" } },

  // U23
  { re: /u23.*(?:wom[ae]n|dam|femme|femenin)/i, match: { ageCategory: "u23", gender: "women" } },
  { re: /(?:wom[ae]n|femme|femenin).*u23/i, match: { ageCategory: "u23", gender: "women" } },
  { re: /under.?23.*(?:wom[ae]n|dam|femme)/i, match: { ageCategory: "u23", gender: "women" } },
  { re: /u23.*(?:\bmen\b|herr|homme|masculin)/i, match: { ageCategory: "u23", gender: "men" } },
  { re: /(?:\bmen\b|homme|masculin).*u23/i, match: { ageCategory: "u23", gender: "men" } },
  { re: /under.?23.*(?:\bmen\b|herr|homme)/i, match: { ageCategory: "u23", gender: "men" } },

  // Junior
  { re: /junior.*(?:wom[ae]n|dam|pige|femme|fille|femenin)/i, match: { ageCategory: "junior", gender: "women" } },
  { re: /(?:wom[ae]n|femme).*junior/i, match: { ageCategory: "junior", gender: "women" } },
  { re: /junior.*(?:\bmen\b|herr|dreng|homme|garçon|masculin)/i, match: { ageCategory: "junior", gender: "men" } },
  { re: /(?:\bmen\b|homme).*junior/i, match: { ageCategory: "junior", gender: "men" } },

  // Generic word-boundary patterns
  { re: /\bwom[ae]n\b.*\belite\b|\belite\b.*\bwom[ae]n\b|\belite\b.*\bfemme\b|\bfemme\b.*\belite\b/i, match: { ageCategory: "elite", gender: "women" } },
  { re: /\bmen\b.*\belite\b|\belite\b.*\bmen\b|\belite\b.*\bhomme\b|\bhomme\b.*\belite\b/i, match: { ageCategory: "elite", gender: "men" } },
  { re: /\bwom[ae]n\b.*\bunder\s?23\b|\bunder\s?23\b.*\bwom[ae]n\b/i, match: { ageCategory: "u23", gender: "women" } },
  { re: /\bmen\b.*\bunder\s?23\b|\bunder\s?23\b.*\bmen\b/i, match: { ageCategory: "u23", gender: "men" } },
  { re: /\bwom[ae]n\b.*\bjunior\b|\bjunior\b.*\bwom[ae]n\b/i, match: { ageCategory: "junior", gender: "women" } },
  { re: /\bmen\b.*\bjunior\b|\bjunior\b.*\bmen\b/i, match: { ageCategory: "junior", gender: "men" } },

  // RaceResult French combined format: "U23 & Elite Homme / Man UCI"
  { re: /\b(?:u23|under.?23)\b.*\b(?:femme|wom[ae]n)\b/i, match: { ageCategory: "elite", gender: "women" } },
  { re: /\b(?:u23|under.?23)\b.*\b(?:homme|\bman\b)\b/i, match: { ageCategory: "elite", gender: "men" } },

  // Catch-all: "Homme / Man" or "Femme / Woman" without age category → elite
  { re: /\bfemme\b.*\bwom[ae]n\b|\bwom[ae]n\b.*\bfemme\b/i, match: { ageCategory: "elite", gender: "women" } },
  { re: /\bhomme\b.*\bman\b|\bman\b.*\bhomme\b/i, match: { ageCategory: "elite", gender: "men" } },
];

export function classifyCategory(name: string): CategoryMatch | null {
  for (const { re, match } of CATEGORY_PATTERNS) {
    if (re.test(name)) return match;
  }
  return null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function fetchHTML(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (e: any) {
    if (attempt < 3) { await sleep(attempt * 3000); return fetchHTML(url, attempt + 1); }
    throw e;
  }
}

export async function fetchJSON<T>(url: string, attempt = 1): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json() as Promise<T>;
  } catch (e: any) {
    if (attempt < 3) { await sleep(attempt * 2000); return fetchJSON<T>(url, attempt + 1); }
    throw e;
  }
}

// ─── Name normalizer ──────────────────────────────────────────────────────────

export function normalizeName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  if (/^[A-Z][A-Z\-]+$/.test(parts[0])) {
    const lastName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
    const firstName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    return { firstName, lastName };
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

// ─── Time parser ──────────────────────────────────────────────────────────────

export function parseTimeToSeconds(raw: string): number | null {
  const cleaned = raw.replace(/\d+\s*Pts.*$/i, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--:--:--") return null;
  // Handle "1:22:00.123" or "1:22:00" or "22:00"
  const parts = cleaned.split(/[:.]/).map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPORTSTIMING ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

interface SportstimingCategory {
  id: string;
  name: string;
  match: CategoryMatch | null;
}

function parseSportstimingCategories(html: string): SportstimingCategory[] {
  const $ = cheerio.load(html);
  const cats: SportstimingCategory[] = [];
  $(".selectDistance option").each((_, el) => {
    const val = $(el).val() as string;
    const name = $(el).text().trim();
    if (!val || val.startsWith("d")) return;
    cats.push({ id: val, name, match: classifyCategory(name) });
  });
  return cats;
}

function parseSportstimingResultRows(html: string): Array<{ position: number; bib: string; name: string; time: string; country?: string }> {
  const $ = cheerio.load(html);
  const results: Array<{ position: number; bib: string; name: string; time: string; country?: string }> = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;
    const pos = parseInt($(cells[0]).text().trim(), 10);
    if (isNaN(pos)) return;
    const bib = $(cells[1]).text().trim();
    const time = $(cells[2]).text().trim();
    const nameEl = $(cells[3]).find("a[href*='/results/']");
    const name = nameEl.find("span").last().text().trim() || nameEl.text().trim();
    if (!name) return;
    const country = $(cells[3]).find("img").attr("title") || undefined;
    results.push({ position: pos, bib, name, time, country });
  });
  return results;
}

function parseTotalPages(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $("ul.pagination li a").each((_, el) => {
    const n = parseInt($(el).text().trim(), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}

export async function sportstimingResults(stId: string): Promise<TimingRaceResult[]> {
  const resultsBase = `https://www.sportstiming.dk/event/${stId}/results`;
  const html = await fetchHTML(resultsBase);
  const cats = parseSportstimingCategories(html).filter(c => c.match !== null);
  const allResults: TimingRaceResult[] = [];

  for (const cat of cats) {
    await sleep(800);
    try {
      const url1 = `${resultsBase}?distance=${cat.id}&gender=A&page=1`;
      const html1 = await fetchHTML(url1);
      const totalPages = parseTotalPages(html1);
      let rows = parseSportstimingResultRows(html1);
      for (let p = 2; p <= Math.min(totalPages, 20); p++) {
        await sleep(700);
        rows = rows.concat(parseSportstimingResultRows(await fetchHTML(`${resultsBase}?distance=${cat.id}&gender=A&page=${p}`)));
      }
      for (const r of rows) {
        allResults.push({
          position: r.position,
          riderName: r.name,
          nationality: r.country,
          timeSeconds: parseTimeToSeconds(r.time),
          dnf: false,
          dns: false,
          categoryName: cat.name,
        });
      }
    } catch (e: any) {
      console.error(`  Sportstiming results error for ${cat.name}: ${e.message}`);
    }
  }

  return allResults;
}

export async function sportstimingStartlist(stId: string): Promise<StartlistEntry[]> {
  const resultsBase = `https://www.sportstiming.dk/event/${stId}`;
  const html = await fetchHTML(`${resultsBase}/results`);
  const cats = parseSportstimingCategories(html).filter(c => c.match !== null);
  const entries: StartlistEntry[] = [];

  for (const cat of cats) {
    await sleep(800);
    try {
      const url = `https://www.sportstiming.dk/event/${stId}/participants?distance=${cat.id}`;
      const pHtml = await fetchHTML(url);
      const $ = cheerio.load(pHtml);
      $("table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const bib = $(cells[0]).text().trim();
        if (!bib || isNaN(parseInt(bib))) return;
        const name = $(cells[1]).find("span").last().text().trim() || $(cells[1]).text().trim();
        const country = $(cells[3])?.find("img").attr("title") || undefined;
        if (name) entries.push({ riderName: name, bibNumber: parseInt(bib) || undefined, nationality: country, categoryName: cat.name });
      });
    } catch (e: any) {
      console.error(`  Sportstiming startlist error for ${cat.name}: ${e.message}`);
    }
  }

  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACERESULT ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

interface RaceResultConfig {
  key: string;
  contests: Record<string, string>;
  lists: Array<{ Name: string; Contest: string; ID: string; Mode?: string }>;
  server?: string;
}

interface RaceResultData {
  data: Record<string, Array<string[]>>;
}

function rrBaseUrl(cfg: RaceResultConfig, eventId: string): string {
  const host = cfg.server ?? "my.raceresult.com";
  return `https://${host}/${eventId}/RRPublish/data`;
}

async function fetchRaceResultConfig(eventId: string): Promise<RaceResultConfig> {
  // Try my.raceresult.com first, fall back to my2
  try {
    return await fetchJSON<RaceResultConfig>(`https://my.raceresult.com/${eventId}/RRPublish/data/config`);
  } catch {
    return fetchJSON<RaceResultConfig>(`https://my2.raceresult.com/${eventId}/RRPublish/data/config`);
  }
}

async function fetchRaceResultList(base: string, key: string, listName: string, contest: string = "0"): Promise<RaceResultData> {
  const url = `${base}/list?key=${key}&listname=${encodeURIComponent(listName)}&contest=${contest}`;
  return fetchJSON<RaceResultData>(url);
}

function parseRaceResultRow(row: string[]): {
  bib: string; name: string; club?: string;
  position: number | null; timeSeconds: number | null;
  dnf: boolean; dns: boolean;
} | null {
  if (row.length < 5) return null;
  const posStr = (row[2] ?? "").toString().trim().replace(/\.$/, ""); // strip trailing dot
  // Name can be at index 4 or 5 depending on format (some have flag img at index 4)
  let name = "";
  let club: string | undefined;
  for (let i = 4; i < Math.min(row.length, 7); i++) {
    const val = (row[i] ?? "").toString().trim();
    if (val && !val.startsWith("[img:") && !name) {
      name = val;
    } else if (val && !val.startsWith("[img:") && name && !club) {
      club = val || undefined;
      break;
    }
  }
  if (!name) return null;
  const isDNF = /^dnf$/i.test(posStr);
  const isDNS = /^dns$/i.test(posStr);
  const isDSQ = /^d[sq]{2}$/i.test(posStr);
  const pos = (isDNF || isDNS || isDSQ) ? null : parseInt(posStr, 10) || null;
  const bib = (row[0] ?? row[3] ?? "").toString().trim();
  // Time: scan for a time-like string in remaining columns
  let timeSeconds: number | null = null;
  if (!isDNF && !isDNS && !isDSQ) {
    for (let i = 6; i < row.length; i++) {
      const val = (row[i] ?? "").toString().trim();
      const t = parseTimeToSeconds(val);
      if (t !== null) { timeSeconds = t; break; }
    }
  }
  return { bib, name, club, position: pos, timeSeconds, dnf: isDNF || isDSQ, dns: isDNS };
}

export async function raceresultResults(rrId: string): Promise<TimingRaceResult[]> {
  const cfg = await fetchRaceResultConfig(rrId);
  if (!cfg.key) throw new Error("No API key in RaceResult config");
  const base = rrBaseUrl(cfg, rrId);

  // Prefer "Classement Scratch" lists — they have clean per-contest results.
  // Avoid "Catégories FFC" or other category breakdowns which can have nested
  // data structures or cross-gender sub-categories within a single contest.
  const scratchOnly = cfg.lists.filter(l =>
    /scratch/i.test(l.Name) && l.Mode !== "hidden"
  );
  const scratchOrResult = cfg.lists.filter(l =>
    /scratch|result/i.test(l.Name) && l.Mode !== "hidden"
  );
  const scratchLists = scratchOnly.length > 0 ? scratchOnly : scratchOrResult;
  const listsToTry = scratchLists.length > 0 ? scratchLists : cfg.lists.filter(l => l.Mode !== "hidden");
  if (listsToTry.length === 0) throw new Error("No visible lists in RaceResult config");

  const allResults: TimingRaceResult[] = [];

  // Fetch each contest's results separately
  for (const listEntry of listsToTry) {
    const contest = listEntry.Contest || "0";
    const contestName = cfg.contests[contest] ?? `Contest ${contest}`;
    await sleep(500);
    try {
      const data = await fetchRaceResultList(base, cfg.key, listEntry.Name, contest);
      if (!data?.data) continue;

      for (const [key, rows] of Object.entries(data.data)) {
        // Skip nested dict structures (e.g. FFC category breakdowns)
        if (!Array.isArray(rows)) continue;
        const catName = key.replace(/^#\d+_/, "").trim();
        // Use contest name for category since catName is often empty or generic
        const displayName = contestName;
        // Skip DNF/DNS/Abandons categories — they're handled by position parsing
        if (/abandon|non\s+partant|dnf|dns/i.test(catName)) {
          // Still parse them as DNF/DNS entries
          for (const row of rows) {
            const parsed = parseRaceResultRow(row);
            if (!parsed) continue;
            allResults.push({
              position: null, riderName: parsed.name, team: parsed.club,
              timeSeconds: null, dnf: parsed.dnf || /abandon/i.test(catName),
              dns: parsed.dns || /non\s+partant/i.test(catName),
              categoryName: displayName,
            });
          }
          continue;
        }

        for (const row of rows) {
          const parsed = parseRaceResultRow(row);
          if (!parsed) continue;
          allResults.push({
            position: parsed.position,
            riderName: parsed.name,
            team: parsed.club,
            timeSeconds: parsed.timeSeconds,
            dnf: parsed.dnf,
            dns: parsed.dns,
            categoryName: displayName,
          });
        }
      }
    } catch {
      continue;
    }
  }

  return allResults;
}

export async function raceresultStartlist(rrId: string): Promise<StartlistEntry[]> {
  const cfg = await fetchRaceResultConfig(rrId);
  if (!cfg.key) throw new Error("No API key in RaceResult config");
  const base = rrBaseUrl(cfg, rrId);

  const listEntry = cfg.lists.find(l => /start|grille/i.test(l.Name)) ?? cfg.lists[0];
  if (!listEntry) return [];

  await sleep(500);
  try {
    const contest = listEntry.Contest || "0";
    const data = await fetchRaceResultList(base, cfg.key, listEntry.Name, contest);
    if (!data?.data) return [];

    const entries: StartlistEntry[] = [];
    for (const [key, rows] of Object.entries(data.data)) {
      const catName = key.replace(/^#\d+_/, "");
      for (const row of rows) {
        if (row.length < 5) continue;
        const name = (row[4] ?? "").toString().trim();
        const bib = (row[0] ?? row[3] ?? "").toString().trim();
        if (name) entries.push({ riderName: name, bibNumber: parseInt(bib) || undefined, categoryName: catName });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQTIMING ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

export async function eqtimingResults(eqId: string): Promise<TimingRaceResult[]> {
  const html = await fetchHTML(`https://live.eqtiming.com/${eqId}/results`);
  const $ = cheerio.load(html);
  const allResults: TimingRaceResult[] = [];

  // EqTiming shows results in tables, grouped by category/class
  let currentCategory = "";
  $("h2, h3, h4, .category-header").each((_, el) => {
    currentCategory = $(el).text().trim();
  });

  $("table").each((_, tbl) => {
    // Try to find a category heading before this table
    const heading = $(tbl).prevAll("h2, h3, h4, .category-header").first().text().trim();
    const catName = heading || currentCategory || "Unknown";

    $(tbl).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 3) return;

      const posText = $(cells[0]).text().trim();
      if (!posText || /^(pos|rank|#)$/i.test(posText)) return;

      const isDnf = /^dnf$/i.test(posText);
      const isDns = /^dns$/i.test(posText);
      const position = (isDnf || isDns) ? null : parseInt(posText, 10) || null;
      if (position === null && !isDnf && !isDns) return;

      // Name is typically in column 1 or 2
      const name = $(cells[1]).text().trim() || $(cells[2]).text().trim();
      if (!name) return;

      // Time is typically the last column or second-to-last
      const timeText = $(cells[cells.length - 1]).text().trim() || $(cells[cells.length - 2]).text().trim();
      const timeSeconds = (isDnf || isDns) ? null : parseTimeToSeconds(timeText);

      // Nationality might be in an img flag or text cell
      const nationality = $(row).find("img[title]").first().attr("title") || undefined;

      allResults.push({ position, riderName: name, nationality, timeSeconds, dnf: isDnf, dns: isDns, categoryName: catName });
    });
  });

  return allResults;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════════

export type TimingSystem = "sportstiming" | "raceresult" | "eqtiming";

export const SUPPORTED_TIMING_SYSTEMS: TimingSystem[] = ["sportstiming", "raceresult", "eqtiming"];

export async function scrapeResults(system: TimingSystem, eventId: string): Promise<TimingRaceResult[]> {
  switch (system) {
    case "sportstiming": return sportstimingResults(eventId);
    case "raceresult": return raceresultResults(eventId);
    case "eqtiming": return eqtimingResults(eventId);
    default: throw new Error(`Unsupported timing system: ${system}`);
  }
}

export async function scrapeStartlist(system: TimingSystem, eventId: string): Promise<StartlistEntry[]> {
  switch (system) {
    case "sportstiming": return sportstimingStartlist(eventId);
    case "raceresult": return raceresultStartlist(eventId);
    case "eqtiming": return []; // EqTiming doesn't typically publish startlists
    default: throw new Error(`Unsupported timing system: ${system}`);
  }
}
