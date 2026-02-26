/**
 * fetch-rider-news.ts
 *
 * Fetches Google News RSS feeds for injuries, transfers, and form news.
 * Matches articles against all riders in the DB (upcoming + top-rated).
 * Outputs JSON in the format gossip-hunter.ts expects, piped directly to it.
 *
 * Usage:
 *   cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/fetch-rider-news.ts | node_modules/.bin/tsx scripts/agents/gossip-hunter.ts
 *
 * Flags:
 *   --upcoming-days <n>   Include riders in races within N days (default: 21)
 *   --min-elo <n>         Also include riders with ELO above threshold (default: 1500)
 *   --dry-run             Print matches without piping to gossip-hunter
 */

import { config } from "dotenv";
// Suppress dotenvx verbose stdout output before calling config
process.env.DOTENV_QUIET = "1";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const UPCOMING_DAYS = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--upcoming-days") ?? "21"
);
const MIN_ELO = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--min-elo") ?? "1500"
);
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Google News queries ───────────────────────────────────────────────────

const FEEDS = [
  {
    url: "https://news.google.com/rss/search?q=cyclist+injury+crash+withdrawal+DNS+DNF+sick+2026&hl=en-US&gl=US&ceid=US:en",
    category: "injury" as const,
  },
  {
    url: "https://news.google.com/rss/search?q=cycling+rider+transfer+contract+signing+team+2026&hl=en-US&gl=US&ceid=US:en",
    category: "transfer" as const,
  },
  {
    url: "https://news.google.com/rss/search?q=cycling+rider+form+fitness+training+race+preview+2026&hl=en-US&gl=US&ceid=US:en",
    category: "form" as const,
  },
  {
    url: "https://news.google.com/rss/search?q=mountain+bike+MTB+XCO+rider+race+result+2026&hl=en-US&gl=US&ceid=US:en",
    category: "form" as const,
  },
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface RawArticle {
  title: string;
  snippet: string;
  url: string;
  source: string;
  pubDate: string;
  category: "injury" | "transfer" | "form";
}

interface GossipInput {
  riderName: string;
  riderId: string;
  news: Array<{ title: string; snippet: string; source: string; url: string; date?: string }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseRSSItems(xml: string): Array<{ title: string; link: string; description: string; pubDate: string; source: string }> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string; source: string }> = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const content = match[1];
    const title =
      content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<title>([\s\S]*?)<\/title>/)?.[1] ||
      "";
    const link =
      content.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1] ||
      content.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/)?.[1] ||
      "";
    const description =
      content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      content.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      "";
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    // Google News puts the actual source publication in <source>
    const source = content.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || "google-news";

    if (title && link) {
      items.push({ title: title.trim(), link, description: description.substring(0, 400), pubDate, source });
    }
  }
  return items;
}

async function fetchFeed(url: string): Promise<Array<{ title: string; link: string; description: string; pubDate: string; source: string }>> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`  Feed ${url.substring(0, 60)}... HTTP ${res.status}`);
      return [];
    }
    return parseRSSItems(await res.text());
  } catch (e) {
    console.error(`  Feed error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// Single-token names that are too common to match alone
const AMBIGUOUS_TOKENS = new Set([
  "milan", "paris", "roma", "rome", "daniel", "thomas", "fred", "oscar", "alex",
  "mark", "ben", "tim", "sam", "adam", "tom", "jack", "max", "lucas", "luca",
  "ward", "noah", "victor", "chris", "mike", "ivan", "jonas", "peter", "gee",
  "cavia", "bonnet", "marit", "laporte",
]);

/**
 * Build match strategies for a rider name.
 * Each strategy is a list of substrings ALL of which must appear in the article text.
 * Priority: full name > accented full name > long unique last name only.
 * Common/short names are never matched alone.
 */
function buildMatchStrategies(rawName: string): string[][] {
  const stripped = rawName
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  const accented = rawName.trim().toLowerCase().replace(/\s+/g, " ");

  // Handle "LASTNAME Firstname" storage format → reorder to "Firstname Lastname"
  const rawParts = rawName.trim().split(/\s+/);
  let normalised = stripped;
  if (rawParts.length >= 2 && rawParts[0] === rawParts[0].toUpperCase() && /[A-Z]/.test(rawParts[0])) {
    const strippedParts = stripped.split(" ");
    const first = strippedParts[strippedParts.length - 1];
    const last = strippedParts.slice(0, strippedParts.length - 1).join(" ");
    normalised = `${first} ${last}`;
  }

  const parts = normalised.split(" ").filter((p) => p.length > 0);
  const strategies: string[][] = [];

  // Full normalised name
  strategies.push([normalised]);
  if (accented !== stripped) strategies.push([accented]);
  // Also try stripped version of re-ordered name
  if (normalised !== stripped) strategies.push([stripped]);

  // Last name alone — only if long enough and not ambiguous
  const lastName = parts[parts.length - 1];
  if (lastName.length >= 8 && !AMBIGUOUS_TOKENS.has(lastName)) {
    strategies.push([lastName]);
  }

  return strategies;
}

function articleMatchesRider(title: string, description: string, strategies: string[][]): boolean {
  const haystack = `${title} ${description}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return strategies.some((tokens) => tokens.every((t) => haystack.includes(t)));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load target riders from DB
  const today = new Date().toISOString().substring(0, 10);
  const futureDate = new Date(Date.now() + UPCOMING_DAYS * 86400000).toISOString().substring(0, 10);

  console.error(`\n🔍 Fetching target riders (upcoming ${UPCOMING_DAYS}d + ELO>${MIN_ELO})...`);

  // Riders in upcoming startlists
  const upcomingRiders = await sql`
    SELECT DISTINCT r.id, r.name
    FROM riders r
    JOIN race_startlist rs ON rs.rider_id = r.id
    JOIN races ra ON ra.id = rs.race_id
    WHERE ra.date BETWEEN ${today} AND ${futureDate}
  `;

  // Top-rated riders by ELO (road + MTB)
  const topRiders = await sql`
    SELECT r.id, r.name
    FROM riders r
    WHERE r.id IN (
      SELECT rider_id FROM rider_discipline_stats
      WHERE current_elo > ${MIN_ELO}
      ORDER BY current_elo DESC
      LIMIT 150
    )
  `;

  // Merge and deduplicate
  const riderMap = new Map<string, string>();
  for (const r of [...upcomingRiders, ...topRiders]) {
    riderMap.set(r.id, r.name);
  }

  console.error(`  Target riders: ${riderMap.size} (${upcomingRiders.length} upcoming, ${topRiders.length} top-ELO)`);

  // Precompute match strategies for all riders
  const riderVariants = new Map<string, { name: string; strategies: string[][] }>();
  for (const [id, name] of riderMap) {
    riderVariants.set(id, { name, strategies: buildMatchStrategies(name) });
  }

  // 2. Fetch all feeds in parallel
  console.error(`  Fetching ${FEEDS.length} Google News feeds...`);
  const feedResults = await Promise.all(
    FEEDS.map(async ({ url, category }) => {
      const items = await fetchFeed(url);
      console.error(`  [${category}] ${items.length} items`);
      return items.map((item) => ({ ...item, category }));
    })
  );

  const allArticles: RawArticle[] = feedResults.flat().map((item) => ({
    title: item.title,
    snippet: item.description,
    url: item.link,
    source: item.source,
    pubDate: item.pubDate,
    category: item.category as RawArticle["category"],
  }));

  console.error(`  Total articles: ${allArticles.length}`);

  // 3. Match articles to riders
  const gossipMap = new Map<string, GossipInput>();

  for (const article of allArticles) {
    for (const [id, { name, strategies }] of riderVariants) {
      if (articleMatchesRider(article.title, article.snippet, strategies)) {
        if (!gossipMap.has(id)) {
          gossipMap.set(id, { riderName: name, riderId: id, news: [] });
        }
        const entry = gossipMap.get(id)!;
        // Avoid duplicate URLs per rider
        if (!entry.news.some((n) => n.url === article.url)) {
          entry.news.push({
            title: article.title,
            snippet: article.snippet,
            source: article.source,
            url: article.url,
            date: article.pubDate,
          });
        }
      }
    }
  }

  const matched = [...gossipMap.values()].filter((g) => g.news.length > 0);
  console.error(`  Matched ${matched.length} riders with news`);

  if (DRY_RUN) {
    for (const entry of matched) {
      console.error(`\n  🏍️  ${entry.riderName} (${entry.news.length} articles)`);
      for (const n of entry.news) {
        console.error(`    - [${n.source}] ${n.title.substring(0, 80)}`);
      }
    }
    return;
  }

  if (matched.length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  // Output JSON array for gossip-hunter.ts to consume
  console.log(JSON.stringify(matched));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
