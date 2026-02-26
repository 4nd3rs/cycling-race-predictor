/**
 * fetch-news-digest.ts
 *
 * General cycling news digest — road + MTB.
 * Pulls from multiple RSS sources + Google News, deduplicates,
 * groups by category, and outputs structured JSON for the cron agent to post.
 *
 * Sources are documented in CONTENT_SOURCES.md.
 *
 * Usage:
 *   cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/fetch-news-digest.ts
 *   Flags:
 *     --since-hours <n>   Only include items published in the last N hours (default: 14)
 *     --max-per-category  Max items per category (default: 5)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const SINCE_HOURS = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--since-hours") ?? "14"
);
const MAX_PER_CAT = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--max-per-category") ?? "5"
);

// ─── Source definitions ────────────────────────────────────────────────────

interface FeedSource {
  name: string;
  url: string;
  discipline: "road" | "mtb" | "both";
  type: "rss" | "atom";
}

const RSS_SOURCES: FeedSource[] = [
  { name: "cyclingnews", url: "https://www.cyclingnews.com/feeds.xml", discipline: "both", type: "rss" },
  { name: "inrng", url: "https://inrng.com/feed/", discipline: "road", type: "rss" },
  { name: "rouleur", url: "https://www.rouleur.cc/blogs/the-rouleur-journal.atom", discipline: "road", type: "atom" },
];

const GOOGLE_NEWS_QUERIES: Array<{ query: string; category: "road" | "mtb" | "transfers" | "injuries" | "general" }> = [
  { query: "professional cycling road race UCI peloton 2026",  category: "road" },
  { query: "UCI mountain bike XCO XCC World Cup 2026",         category: "mtb" },
  { query: "cycling transfer contract rider team signing",     category: "transfers" },
  { query: "cyclist injury withdrawal DNS DNF abandoned 2026", category: "injuries" },
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface DigestItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: Date | null;
  category: "road" | "mtb" | "transfers" | "injuries" | "general";
  discipline: "road" | "mtb" | "both";
}

// ─── RSS/Atom parser ───────────────────────────────────────────────────────

function parseItems(xml: string, sourceName: string, discipline: FeedSource["discipline"]): DigestItem[] {
  const items: DigestItem[] = [];
  // Handle both <item> (RSS) and <entry> (Atom)
  const tagRe = xml.includes("<entry") ? /<entry>([\s\S]*?)<\/entry>/g : /<item>([\s\S]*?)<\/item>/g;
  const matches = xml.matchAll(tagRe);

  for (const match of matches) {
    const content = match[1];

    const title =
      content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, "") ||
      "";

    // Atom uses <link href="..."/> or <link>url</link>; RSS uses <link>url</link>
    const url =
      content.match(/<link[^>]+href="(https?:\/\/[^"]+)"/)?.[1] ||
      content.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1] ||
      content.match(/<guid isPermaLink="true">(https?:\/\/[^\s<]+)<\/guid>/)?.[1] ||
      "";

    const snippet =
      content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1]?.replace(/<[^>]+>/g, "").trim().substring(0, 300) ||
      content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.replace(/<[^>]+>/g, "").trim().substring(0, 300) ||
      "";

    const pubDate =
      content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ||
      content.match(/<published>(.*?)<\/published>/)?.[1] ||
      content.match(/<updated>(.*?)<\/updated>/)?.[1] ||
      null;

    if (!title || !url) continue;

    items.push({
      title: title.trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      url: url.trim(),
      source: sourceName,
      snippet: snippet.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      publishedAt: pubDate ? new Date(pubDate) : null,
      category: discipline === "mtb" ? "mtb" : "road",
      discipline,
    });
  }

  return items;
}

function categoriseItem(item: DigestItem): DigestItem {
  const text = `${item.title} ${item.snippet}`.toLowerCase();

  if (/injur|crash|fractur|broken|surgery|hospital|withdraw|abandon|dns\b|dnf\b|sidelined|out for/.test(text)) {
    return { ...item, category: "injuries" };
  }
  if (/transfer|contract|sign|join|move|leaving|departure|team\s+change/.test(text)) {
    return { ...item, category: "transfers" };
  }
  if (/\bmtb\b|mountain bike|xco\b|xcc\b|cross.country|enduro|downhill/.test(text)) {
    return { ...item, category: "mtb" };
  }
  return item;
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchFeed(source: FeedSource): Promise<DigestItem[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`  [${source.name}] HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = parseItems(xml, source.name, source.discipline);
    return items.map(categoriseItem);
  } catch (e) {
    console.error(`  [${source.name}] Error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function fetchGoogleNews(
  query: string,
  category: DigestItem["category"]
): Promise<DigestItem[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`  [google-news:${category}] HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const discipline: FeedSource["discipline"] = category === "mtb" ? "mtb" : "road";
    const items = parseItems(xml, `google-news`, discipline);
    return items.map((item) => ({ ...item, category }));
  } catch (e) {
    console.error(`  [google-news:${category}] Error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface DigestOutput {
  generatedAt: string;
  sinceHours: number;
  categories: {
    road: DigestItem[];
    mtb: DigestItem[];
    transfers: DigestItem[];
    injuries: DigestItem[];
  };
  totalFetched: number;
  totalRelevant: number;
}

async function main() {
  console.error(`\n📰 Cycling News Digest — last ${SINCE_HOURS}h`);
  const cutoff = new Date(Date.now() - SINCE_HOURS * 3600 * 1000);

  // Fetch all in parallel
  const [rssResults, googleResults] = await Promise.all([
    Promise.all(RSS_SOURCES.map(fetchFeed)),
    Promise.all(GOOGLE_NEWS_QUERIES.map(({ query, category }) => fetchGoogleNews(query, category))),
  ]);

  const all: DigestItem[] = [...rssResults.flat(), ...googleResults.flat()];
  console.error(`  Total fetched: ${all.length}`);

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = all.filter((item) => {
    // Normalise Google News redirect URLs by title for dedup
    const key = item.title.toLowerCase().substring(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter by recency
  const recent = deduped.filter((item) => {
    if (!item.publishedAt) return true; // keep items with no date
    return item.publishedAt >= cutoff;
  });

  console.error(`  After dedup + recency filter: ${recent.length}`);

  // Group by category, cap per category
  const byCategory = (cat: DigestItem["category"]) =>
    recent
      .filter((i) => i.category === cat)
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .slice(0, MAX_PER_CAT);

  const output: DigestOutput = {
    generatedAt: new Date().toISOString(),
    sinceHours: SINCE_HOURS,
    categories: {
      road: byCategory("road"),
      mtb: byCategory("mtb"),
      transfers: byCategory("transfers"),
      injuries: byCategory("injuries"),
    },
    totalFetched: all.length,
    totalRelevant: recent.length,
  };

  // Summary to stderr
  console.error(`  Road: ${output.categories.road.length} | MTB: ${output.categories.mtb.length} | Transfers: ${output.categories.transfers.length} | Injuries: ${output.categories.injuries.length}`);

  // Output JSON to stdout for the cron agent to consume
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
