import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  riders,
  riderRumours,
  raceStartlist,
  races,
} from "@/lib/db";
import { eq, and, gte, lte, ilike, desc } from "drizzle-orm";
import { notifyRiderFollowers } from "@/lib/notify-followers";

export const maxDuration = 60;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsItem {
  title: string;
  snippet: string;
  source: string;
  url: string;
  date?: string;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

type RumourType = "injury" | "form" | "transfer" | "team_dynamics" | "other";

// ── RSS parsing ───────────────────────────────────────────────────────────────

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

    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        description: description.replace(/<[^>]+>/g, "").trim().substring(0, 400),
        pubDate,
      });
    }
  }
  return items;
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyNews(news: NewsItem[]): { type: RumourType; sentiment: number } {
  const text = news.map((n) => `${n.title} ${n.snippet}`).join(" ").toLowerCase();

  let type: RumourType = "other";
  if (/injur|crash|fracture|broken|surgery|hospital|out for|sidelined|withdraw/.test(text)) {
    type = "injury";
  } else if (/transfer|sign|contract|move|join|leaving|departure/.test(text)) {
    type = "transfer";
  } else if (/form|fitness|training|strong|peak|shape|confident|ready|dominant/.test(text)) {
    type = "form";
  } else if (/team.*dynamic|leader|domestique|conflict|tension|support|captain/.test(text)) {
    type = "team_dynamics";
  }

  const positiveWords = /win|strong|peak|excellent|dominant|confident|great|improve|recover|return|ready|fast|power|success/g;
  const negativeWords = /injur|crash|fracture|broken|surgery|hospital|withdraw|struggle|poor|disappoint|sick|illness|doubt|concern|problem|abandon|dns|dnf/g;

  const positiveCount = (text.match(positiveWords) || []).length;
  const negativeCount = (text.match(negativeWords) || []).length;
  const total = positiveCount + negativeCount;

  let sentiment = 0;
  if (total > 0) {
    sentiment = Math.round(((positiveCount - negativeCount) / total) * 100) / 100;
  }

  return { type, sentiment };
}

// ── Summary generation ────────────────────────────────────────────────────────

function heuristicSummary(riderName: string, news: NewsItem[], type: RumourType, sentiment: number): string {
  const latestTitle = news[0]?.title || "Recent news";
  const sentimentLabel = sentiment > 0.3 ? "positive" : sentiment < -0.3 ? "concerning" : "mixed";

  switch (type) {
    case "injury":
      return `${riderName}: Injury-related news detected. ${latestTitle}. Overall outlook is ${sentimentLabel}.`;
    case "form":
      return `${riderName}: Form/fitness update. ${latestTitle}. Current signals are ${sentimentLabel}.`;
    case "transfer":
      return `${riderName}: Transfer/team news. ${latestTitle}.`;
    case "team_dynamics":
      return `${riderName}: Team dynamics update. ${latestTitle}.`;
    default:
      return `${riderName}: ${latestTitle}. Sentiment is ${sentimentLabel}.`;
  }
}

async function generateSummary(
  riderName: string,
  news: NewsItem[],
  type: RumourType,
  sentiment: number
): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();

      const newsText = news
        .map((n) => `- ${n.title}: ${n.snippet} (${n.source})`)
        .join("\n");

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Summarize these news items about cyclist ${riderName} in 1-2 sentences. Focus on race performance impact. Type: ${type}, sentiment: ${sentiment}.\n\n${newsText}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        return textBlock.text;
      }
    } catch (err) {
      console.error(`[gossip-hunter] AI summary failed for ${riderName}: ${err}`);
    }
  }

  return heuristicSummary(riderName, news, type, sentiment);
}

// ── Search for rider news via Google News RSS ─────────────────────────────────

async function searchRiderNews(riderName: string): Promise<NewsItem[]> {
  const query = encodeURIComponent(`"${riderName}" cycling`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const items = parseRSSItems(xml);

    // Only keep recent items (last 7 days)
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = items.filter((item) => {
      if (!item.pubDate) return true;
      try { return new Date(item.pubDate) >= cutoff; } catch { return true; }
    });

    // Filter items that actually mention the rider
    const nameParts = riderName.toLowerCase().split(" ");
    const lastName = nameParts[nameParts.length - 1];
    const relevant = recent.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return text.includes(lastName);
    });

    return relevant.slice(0, 5).map((item) => ({
      title: item.title,
      snippet: item.description,
      source: "google-news",
      url: item.link,
      date: item.pubDate,
    }));
  } catch {
    return [];
  }
}

// ── Process a rider's gossip ──────────────────────────────────────────────────

async function processRiderGossip(
  riderId: string,
  riderName: string,
  news: NewsItem[]
): Promise<"upserted" | "no_news" | "error"> {
  if (news.length === 0) return "no_news";

  try {
    const { type, sentiment } = classifyNews(news);
    const summary = await generateSummary(riderName, news, type, sentiment);

    const existing = await db.query.riderRumours.findFirst({
      where: eq(riderRumours.riderId, riderId),
    });

    if (existing) {
      await db
        .update(riderRumours)
        .set({
          aggregateScore: String(sentiment),
          tipCount: (existing.tipCount || 0) + news.length,
          summary,
          lastUpdated: new Date(),
        })
        .where(eq(riderRumours.id, existing.id));
    } else {
      await db.insert(riderRumours).values({
        riderId,
        aggregateScore: String(sentiment),
        tipCount: news.length,
        summary,
      });
    }

    // Notify followers if sentiment is strong
    if (Math.abs(sentiment) >= 0.4) {
      try {
        const isNegative = sentiment < 0;
        const emoji = isNegative ? "⚠️" : "📈";
        const label = isNegative ? "Negative intel detected" : "Positive form update";
        const msg = [
          `${emoji} <b>${label}: ${riderName}</b>`,
          ``,
          summary,
          ``,
          `👉 <a href="https://procyclingpredictor.com/riders/${riderId}">View on Pro Cycling Predictor</a>`,
        ].join("\n");
        await notifyRiderFollowers(riderId, msg);
      } catch (notifyErr) {
        console.error(`[gossip-hunter] Notification error for ${riderName}:`, notifyErr);
      }
    }

    return "upserted";
  } catch (err) {
    console.error(`[gossip-hunter] Error processing ${riderName}: ${err}`);
    return "error";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find riders on upcoming race startlists (next 7 days)
    const today = new Date().toISOString().slice(0, 10);
    const weekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const startlistRiders = await db
      .select({
        riderId: raceStartlist.riderId,
        riderName: riders.name,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .innerJoin(races, eq(raceStartlist.raceId, races.id))
      .where(
        and(
          gte(races.date, today),
          lte(races.date, weekOut),
          eq(races.status, "active")
        )
      );

    // Deduplicate riders
    const uniqueRiders = new Map<string, string>();
    for (const r of startlistRiders) {
      uniqueRiders.set(r.riderId, r.riderName);
    }

    // Limit to 15 riders per run to stay within 60s
    const riderEntries = Array.from(uniqueRiders.entries()).slice(0, 15);

    let upserted = 0;
    let noNews = 0;
    let errors = 0;

    for (const [riderId, riderName] of riderEntries) {
      const news = await searchRiderNews(riderName);
      const result = await processRiderGossip(riderId, riderName, news);
      if (result === "upserted") upserted++;
      else if (result === "no_news") noNews++;
      else errors++;
    }

    return NextResponse.json({
      success: true,
      ridersSearched: riderEntries.length,
      upserted,
      noNews,
      errors,
    });
  } catch (error) {
    console.error("[cron/gossip-hunter]", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
