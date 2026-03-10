import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  db,
  raceEvents,
  raceNews,
} from "@/lib/db";
import { and, gte, lte } from "drizzle-orm";

export const maxDuration = 60;

// ── RSS parsing ───────────────────────────────────────────────────────────────

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  imageUrl?: string;
}

const RSS_FEEDS = [
  { name: "cyclingnews", url: "https://www.cyclingnews.com/feeds.xml" },
  { name: "inrng", url: "https://inrng.com/feed/" },
];

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const content = match[1];
    const title =
      content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    const link =
      content.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1] ||
      content.match(/<guid isPermaLink="true">(https?:\/\/[^\s<]+)<\/guid>/)?.[1] || "";
    const description =
      content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      content.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    const imageUrl =
      content.match(/enclosure url="(https:\/\/cdn\.mos\.cms\.futurecdn\.net\/[^"]+)"/)?.[1] ||
      content.match(/media:content[^>]*url="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/)?.[1];

    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        description: description.replace(/<[^>]+>/g, "").trim().substring(0, 600),
        pubDate,
        imageUrl,
      });
    }
  }
  return items;
}

// ── Keyword matching ──────────────────────────────────────────────────────────

function buildKeywords(eventName: string, year: string): string[] {
  const kws: string[] = [];

  const nameTokens = eventName
    .toLowerCase()
    .replace(/\d{4}/, "")
    .split(/[\s\-]+/)
    .filter((w) => w.length > 3);
  kws.push(...nameTokens);

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

  if (titleLower.includes(name) || titleLower.includes(name.split(" ")[0])) score += 30;

  for (const kw of keywords) {
    if (titleLower.includes(kw)) score += 15;
    if (descLower.includes(kw)) score += 3;
  }

  if (/preview|prediction|favourite|favorite|startlist|route|parcours/.test(titleLower)) score += 5;

  return score;
}

// ── Scrape for a single event ─────────────────────────────────────────────────

async function scrapeForEvent(event: {
  id: string;
  name: string;
  date: string;
}): Promise<number> {
  const year = event.date.substring(0, 4);
  const keywords = buildKeywords(event.name, year);

  let totalInserted = 0;

  // Scrape RSS feeds
  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const items = parseRSSItems(xml);

      const scored = items
        .map((item) => ({ item, score: scoreItem(item, keywords, event.name) }))
        .filter(({ score }) => score >= 10)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      for (const { item } of scored) {
        try {
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
            })
            .onConflictDoNothing();
          totalInserted++;
        } catch (e: unknown) {
          if (e instanceof Error && !e.message.includes("duplicate")) {
            console.error(`[scrape-race-news] Insert error: ${e.message}`);
          }
        }
      }
    } catch (e: unknown) {
      console.error(`[scrape-race-news] ${feed.name} fetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Google News RSS
  const eventNameClean = event.name.replace(/\s+\d{4}$/, "");
  const googleQuery = encodeURIComponent(`"${eventNameClean}" cycling ${year}`);
  const googleNewsUrl = `https://news.google.com/rss/search?q=${googleQuery}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const gnRes = await fetch(googleNewsUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (gnRes.ok) {
      const gnXml = await gnRes.text();
      const gnItems = parseRSSItems(gnXml);
      const gnScored = gnItems
        .map((item) => ({ item, score: scoreItem(item, keywords, event.name) }))
        .filter(({ score }) => score >= 10)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      for (const { item } of gnScored) {
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
            console.error(`[scrape-race-news] GN insert error: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.error(`[scrape-race-news] Google News error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Cyclingnews race hub page
  const slug = event.name
    .toLowerCase()
    .replace(/\s+\d{4}$/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const hubUrl = `https://www.cyclingnews.com/pro-cycling/races/${slug}-${year}/`;
  try {
    const res = await fetch(hubUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const html = await res.text();
      const articleMatches = [
        ...html.matchAll(
          /"url":"(https:\/\/www\.cyclingnews\.com\/pro-cycling\/[^"]+)","name":"([^"]+)"/g
        ),
      ];

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
    }
  } catch {
    // hub page not found, that's fine
  }

  return totalInserted;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find upcoming events in the next 14 days
    const today = new Date().toISOString().slice(0, 10);
    const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const upcomingEvents = await db
      .select({
        id: raceEvents.id,
        name: raceEvents.name,
        date: raceEvents.date,
      })
      .from(raceEvents)
      .where(
        and(
          gte(raceEvents.date, today),
          lte(raceEvents.date, twoWeeksOut)
        )
      )
      .limit(8); // Limit to 8 events per run to stay within 60s

    const results: Array<{ event: string; inserted: number }> = [];

    for (const event of upcomingEvents) {
      const inserted = await scrapeForEvent(event);
      results.push({ event: event.name, inserted });
    }

    const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);

    return NextResponse.json({
      success: true,
      eventsScraped: results.length,
      totalInserted,
      results,
    });
  } catch (error) {
    console.error("[cron/scrape-race-news]", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
