/**
 * fetch-article-content.ts
 *
 * Fetches full article body for race_news articles that have direct (non-Google-News) URLs.
 * Stores cleaned text in race_news.content.
 *
 * Usage:
 *   tsx scripts/agents/fetch-article-content.ts [--event-slug slug] [--limit 20] [--force]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull, and, not, like } from "drizzle-orm";
import { raceNews, raceEvents } from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

const args = process.argv.slice(2);
const slugIdx = args.indexOf("--event-slug");
const EVENT_SLUG = slugIdx !== -1 ? args[slugIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 20;
const FORCE = args.includes("--force");

const CONTENT_MAX_CHARS = 4000;

function extractText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<\/?(p|div|h[1-6]|li|br|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 40);
  if (lines.length > 0) text = lines.join("\n");
  return text.substring(0, CONTENT_MAX_CHARS);
}

async function fetchDirectUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();
    const text = extractText(html);
    return text.length > 100 ? text : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n📄 Article Content Fetcher");

  let baseCondition;
  if (EVENT_SLUG) {
    const events = await db.select().from(raceEvents).where(eq(raceEvents.slug, EVENT_SLUG)).limit(1);
    if (!events.length) { console.error(`Event not found: ${EVENT_SLUG}`); process.exit(1); }
    console.log(`   Event: ${events[0].name}`);
    baseCondition = eq(raceNews.raceEventId, events[0].id);
  }

  // Only fetch articles with direct URLs (skip Google News)
  const conditions = [
    baseCondition,
    FORCE ? undefined : isNull(raceNews.content),
    not(like(raceNews.url!, "%news.google.com%")),
  ].filter(Boolean);

  const articles = await db.select().from(raceNews)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions as Parameters<typeof and>))
    .limit(LIMIT);

  // Also mark Google News articles as empty so they don't block
  if (!FORCE) {
    const gnConditions = [baseCondition, isNull(raceNews.content), like(raceNews.url!, "%news.google.com%")].filter(Boolean);
    const gnArticles = await db.select({ id: raceNews.id }).from(raceNews)
      .where(gnConditions.length === 1 ? gnConditions[0] : and(...gnConditions as Parameters<typeof and>))
      .limit(50);
    if (gnArticles.length > 0) {
      console.log(`   Marking ${gnArticles.length} Google News URLs as skipped`);
      for (const a of gnArticles) {
        await db.update(raceNews).set({ content: "", contentFetchedAt: new Date() }).where(eq(raceNews.id, a.id));
      }
    }
  }

  console.log(`   Direct articles to fetch: ${articles.length}\n`);
  let fetched = 0, failed = 0;

  for (const article of articles) {
    if (!article.url) continue;
    console.log(`   → ${article.title.substring(0, 70)}`);

    const text = await fetchDirectUrl(article.url);
    if (!text) {
      console.log(`     ❌ Failed`);
      await db.update(raceNews).set({ content: "", contentFetchedAt: new Date() }).where(eq(raceNews.id, article.id));
      failed++;
    } else {
      console.log(`     ✅ ${text.length} chars`);
      await db.update(raceNews).set({ content: text, contentFetchedAt: new Date() }).where(eq(raceNews.id, article.id));
      fetched++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone. Fetched: ${fetched}, Failed: ${failed}`);
}

main().catch(console.error);
