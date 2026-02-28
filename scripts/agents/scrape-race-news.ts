/**
 * scrape-race-news.ts
 * Fetches news articles from cycling RSS feeds, filters by race event, stores in race_news table.
 * Usage: tsx scripts/agents/scrape-race-news.ts [event-slug]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, isNotNull } from "drizzle-orm";
import { raceEvents, raceNews } from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

/** Fetch article text from a direct URL (non-Google-News). Returns null on failure. */
async function fetchArticleContent(url: string): Promise<string | null> {
  if (!url || url.includes("news.google.com")) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<\/?(?:p|div|h[1-6]|li|br|blockquote)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n").trim();
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 40);
    if (lines.length > 0) text = lines.join("\n");
    return text.length > 100 ? text.substring(0, 4000) : null;
  } catch {
    return null;
  }
}

const RSS_FEEDS = [
  { name: "cyclingnews", url: "https://www.cyclingnews.com/feeds.xml" },
  { name: "inrng", url: "https://inrng.com/feed/" },
  { name: "velonews", url: "https://velo.outsideonline.com/feed/" },
  { name: "procycling", url: "https://www.procycling.co.uk/feed/" },
];

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  imageUrl?: string;
  author?: string;
}

function parseRSSItems(xml: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const content = match[1];
    const title =
      content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<title>([\s\S]*?)<\/title>/)?.[1] ||
      "";
    const link =
      content.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1] ||
      content.match(/<guid isPermaLink="true">(https?:\/\/[^\s<]+)<\/guid>/)?.[1] ||
      "";
    const description =
      content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<description>([\s\S]*?)<\/description>/)?.[1] ||
      "";
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    // Try enclosure URL first, then media:content
    const imageUrl =
      content.match(/enclosure url="(https:\/\/cdn\.mos\.cms\.futurecdn\.net\/[^"]+)"/)?.[1] ||
      content.match(/media:content[^>]*url="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/)?.[1];
    const author =
      content.match(/<dc:creator><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      content.match(/<author><!\[CDATA\[.*?\((.*?)\)\]\]>/)?.[1];

    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        description: description.replace(/<[^>]+>/g, "").trim().substring(0, 600),
        pubDate,
        imageUrl,
        author,
      });
    }
  }
  return items;
}

function buildKeywords(eventName: string, year: string): string[] {
  const kws: string[] = [];

  // Parse event name into meaningful tokens
  const nameTokens = eventName
    .toLowerCase()
    .replace(/\d{4}/, "") // remove year
    .split(/[\s\-]+/)
    .filter((w) => w.length > 3);
  kws.push(...nameTokens);

  // Add known aliases
  const aliases: Record<string, string[]> = {
    omloop: ["omloop", "nieuwsblad", "opening weekend"],
    strade: ["strade bianche", "eroica"],
    "paris-roubaix": ["roubaix", "hell of the north"],
    "tour of flanders": ["ronde van vlaanderen", "ronde"],
    "milan-sanremo": ["sanremo", "la primavera"],
    "liège-bastogne-liège": ["liège", "bastogne", "la doyenne"],
    amstel: ["amstel gold"],
    "flèche": ["flèche wallonne", "la flèche"],
    "e3": ["e3 harelbeke"],
    "dwars door": ["dwars door vlaanderen"],
  };

  for (const [key, alts] of Object.entries(aliases)) {
    if (eventName.toLowerCase().includes(key)) {
      kws.push(...alts);
    }
  }

  return [...new Set(kws)];
}

function scoreItem(item: RSSItem, keywords: string[], eventName: string): number {
  const titleLower = item.title.toLowerCase();
  const descLower = item.description.toLowerCase();
  const name = eventName.toLowerCase().replace(/\s+\d{4}$/, "");
  let score = 0;

  // Direct event name match = high score
  if (titleLower.includes(name) || titleLower.includes(name.split(" ")[0])) score += 30;

  // Keyword matches in title
  for (const kw of keywords) {
    if (titleLower.includes(kw)) score += 15;
    if (descLower.includes(kw)) score += 3;
  }

  // Preview/preview signal words
  if (/preview|prediction|favourite|favorite|startlist|route|parcours/.test(titleLower)) score += 5;

  return score;
}

async function scrapeForEvent(eventSlug: string) {
  const events = await db
    .select()
    .from(raceEvents)
    .where(eq(raceEvents.slug, eventSlug))
    .limit(1);

  if (!events.length) {
    console.error(`Event not found: ${eventSlug}`);
    return 0;
  }
  const event = events[0];
  const year = event.date.substring(0, 4);
  const keywords = buildKeywords(event.name, year);
  console.log(`\n📰 Scraping news for: ${event.name}`);
  console.log(`   Keywords: ${keywords.slice(0, 8).join(", ")}`);

  let totalInserted = 0;

  for (const feed of RSS_FEEDS) {
    console.log(`\n   Fetching ${feed.name}...`);
    try {
      const res = await fetch(feed.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.log(`   Failed: HTTP ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const items = parseRSSItems(xml, feed.name);
      console.log(`   Parsed ${items.length} items`);

      // Score and filter
      const scored = items
        .map((item) => ({ item, score: scoreItem(item, keywords, event.name) }))
        .filter(({ score }) => score >= 10)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      console.log(`   Relevant: ${scored.length} items`);

      for (const { item, score } of scored) {
        console.log(`   [${score}] ${item.title.substring(0, 70)}...`);
        try {
          const articleContent = await fetchArticleContent(item.link);
          await db
            .insert(raceNews)
            .values({
              raceEventId: event.id,
              title: item.title,
              summary: item.description || null,
              url: item.link,
              imageUrl: item.imageUrl || null,
              source: feed.name,
              category: item.title.toLowerCase().includes("preview") ? "preview" : "news",
              publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
              content: articleContent || null,
              contentFetchedAt: articleContent !== null ? new Date() : null,
            })
            .onConflictDoNothing();
          if (articleContent) console.log(`     📄 Content fetched: ${articleContent.length} chars`);
          totalInserted++;
        } catch (e: unknown) {
          if (e instanceof Error && !e.message.includes("duplicate")) {
            console.error(`   Insert error: ${e.message}`);
          }
        }
      }
    } catch (e: unknown) {
      console.error(`   Fetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Google News RSS — dynamic query for this specific event
  const eventNameClean = event.name.replace(/\s+\d{4}$/, "");
  const googleQuery = encodeURIComponent(`"${eventNameClean}" cycling ${year}`);
  const googleNewsUrl = `https://news.google.com/rss/search?q=${googleQuery}&hl=en-US&gl=US&ceid=US:en`;
  console.log(`\n   Fetching Google News: ${eventNameClean} ${year}`);
  try {
    const gnRes = await fetch(googleNewsUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (gnRes.ok) {
      const gnXml = await gnRes.text();
      const gnItems = parseRSSItems(gnXml, "google-news");
      const gnScored = gnItems
        .map((item) => ({ item, score: scoreItem(item, keywords, event.name) }))
        .filter(({ score }) => score >= 10)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
      console.log(`   Google News relevant: ${gnScored.length}`);
      for (const { item, score } of gnScored) {
        console.log(`   [GN:${score}] ${item.title.substring(0, 70)}...`);
        try {
          await db
            .insert(raceNews)
            .values({
              raceEventId: event.id,
              title: item.title,
              summary: item.description || null,
              url: item.link,
              imageUrl: item.imageUrl || null,
              source: "google-news",
              category: item.title.toLowerCase().includes("preview") ? "preview" : "news",
              publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            })
            .onConflictDoNothing();
          totalInserted++;
        } catch (e: unknown) {
          if (e instanceof Error && !e.message.includes("duplicate")) {
            console.error(`   Insert error: ${e.message}`);
          }
        }
      }
    } else {
      console.log(`   Google News: HTTP ${gnRes.status}`);
    }
  } catch (e) {
    console.log(`   Google News error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Also scrape the cyclingnews race hub page for more articles
  const slug = event.name
    .toLowerCase()
    .replace(/\s+\d{4}$/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const hubUrl = `https://www.cyclingnews.com/pro-cycling/races/${slug}-${year}/`;
  console.log(`\n   Fetching race hub: ${hubUrl}`);
  try {
    const res = await fetch(hubUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const html = await res.text();

      // Extract article data from JSON-LD or meta tags
      const articleMatches = [
        ...html.matchAll(
          /"url":"(https:\/\/www\.cyclingnews\.com\/pro-cycling\/[^"]+)","name":"([^"]+)"/g
        ),
      ];

      console.log(`   Found ${articleMatches.length} articles in hub`);
      for (const [, articleUrl, articleTitle] of articleMatches.slice(0, 6)) {
        const score = scoreItem(
          { title: articleTitle, link: articleUrl, description: "", pubDate: "" },
          keywords,
          event.name
        );
        if (score >= 8) {
          try {
            await db
              .insert(raceNews)
              .values({
                raceEventId: event.id,
                title: articleTitle.replace(/\\u[\dA-F]{4}/gi, "").trim(),
                url: articleUrl,
                source: "cyclingnews",
                category: "news",
                publishedAt: new Date(),
              })
              .onConflictDoNothing();
            totalInserted++;
          } catch {
            // ignore duplicates
          }
        }
      }
    } else {
      console.log(`   Hub page: HTTP ${res.status}`);
    }
  } catch (e) {
    console.log(`   Hub fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return totalInserted;
}

async function main() {
  const eventSlug = process.argv[2] || "omloop-het-nieuwsblad-2026";
  console.log(`\n🔍 Race News Scraper`);
  const inserted = await scrapeForEvent(eventSlug);
  console.log(`\n✅ Done. Total inserted: ${inserted}`);
}

main().catch(console.error);
