/**
 * scrape-x-intel.ts
 *
 * Scrapes Google News RSS for rider + race intel.
 * Stores raw articles in data/intel/YYYY-MM-DD.jsonl (agent-only, not in DB).
 * Feeds significant items into gossip-hunter for DB storage + follower notifications.
 *
 * Usage:
 *   tsx scripts/agents/scrape-x-intel.ts [--riders] [--races] [--race-slug <slug>] [--limit 5]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { db, riders, raceEvents, races } from "./lib/db";
import { gte, eq, and } from "drizzle-orm";

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const doRiders = args.includes("--riders") || args.length === 0;
const doRaces  = args.includes("--races")  || args.length === 0;
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1] || "10") : 10;
const raceSlugArg = args.includes("--race-slug") ? args[args.indexOf("--race-slug") + 1] : null;

// ─── Intel file storage ───────────────────────────────────────────────────────
const INTEL_DIR = "./data/intel";
const today = new Date().toISOString().slice(0, 10);
const INTEL_FILE = `${INTEL_DIR}/${today}.jsonl`;

interface IntelItem {
  type: "rider" | "race";
  subject: string;       // rider name or race name
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  sentiment?: number;    // -1 to 1 (simple heuristic)
  tags: string[];
}

function loadTodayIntel(): IntelItem[] {
  if (!existsSync(INTEL_FILE)) return [];
  return readFileSync(INTEL_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function appendIntel(items: IntelItem[]) {
  if (!existsSync(INTEL_DIR)) mkdirSync(INTEL_DIR, { recursive: true });
  const lines = items.map((i) => JSON.stringify(i)).join("\n");
  writeFileSync(INTEL_FILE, (existsSync(INTEL_FILE) ? readFileSync(INTEL_FILE, "utf-8") : "") + lines + "\n");
}

// ─── Google News RSS ──────────────────────────────────────────────────────────
interface NewsItem {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
}

async function fetchGoogleNews(query: string, maxItems = 5): Promise<NewsItem[]> {
  const encodedQuery = encodeURIComponent(query);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(rssUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PCP-Intel-Bot/1.0)" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return [];
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of itemBlocks.slice(0, maxItems)) {
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) || block.match(/<title>(.*?)<\/title>/))?.[1] ?? "";
    const link  = (block.match(/<link>(https?:\/\/[^<]+)/) || block.match(/<guid[^>]*>(https?:\/\/[^<]+)/))?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    const source  = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? "Google News";

    if (title && link) {
      items.push({ title: title.replace(/ - [^-]+$/, "").trim(), url: link, publishedAt: pubDate, source });
    }
  }

  return items;
}

// ─── Sentiment heuristic ──────────────────────────────────────────────────────
const NEGATIVE_TERMS = ["injur", "ill", "sick", "crash", "abandon", "dns", "dnf", "withdraw", "out of", "misses", "ruled out", "blow", "concern", "doubt"];
const POSITIVE_TERMS = ["win", "victor", "podium", "form", "strong", "confident", "ready", "comeback", "great", "impressive"];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const t of NEGATIVE_TERMS) if (lower.includes(t)) score -= 0.3;
  for (const t of POSITIVE_TERMS) if (lower.includes(t)) score += 0.25;
  return Math.max(-1, Math.min(1, score));
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  if (/injur|crash|ill|sick/i.test(text)) tags.push("injury");
  if (/withdraw|dns|abandon|out of|misses|ruled out/i.test(text)) tags.push("withdrawal");
  if (/transfer|sign|team/i.test(text)) tags.push("transfer");
  if (/win|victor|podium/i.test(text)) tags.push("form");
  if (/preview|prediction|favourite|favorite/i.test(text)) tags.push("preview");
  return tags;
}

// ─── Dedup against today's intel ─────────────────────────────────────────────
function isNew(url: string, existing: IntelItem[]): boolean {
  return !existing.some((i) => i.url === url);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const existingIntel = loadTodayIntel();
  const newItems: IntelItem[] = [];

  console.log(`\n📡 X-Intel Scraper — ${today}`);
  console.log(`   Existing items today: ${existingIntel.length}\n`);

  // ── 1. Rider intel ───────────────────────────────────────────────────────────
  if (doRiders) {
    // Get top ELO riders from upcoming races (next 14 days)
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 14);
    const cutoff = upcoming.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    const topRiders = await db
      .select({ name: riders.name })
      .from(riders)
      .limit(limitArg);

    // Focus on WorldTour-level names — query by upcoming race startlists
    const upcomingRaces = await db
      .select({ id: races.id, name: races.name })
      .from(races)
      .where(and(gte(races.date, todayStr), eq(races.status, "active")))
      .limit(3);

    // Get top 15 ELO riders across upcoming races
    const riderNames: string[] = [];
    for (const race of upcomingRaces) {
      const raceRiders = await db.execute<{ name: string }>(
        `SELECT r.name FROM riders r
         JOIN race_startlist rs ON rs.rider_id = r.id
         JOIN rider_discipline_stats rds ON rds.rider_id = r.id
         WHERE rs.race_id = '${race.id}'
         ORDER BY rds.current_elo DESC NULLS LAST
         LIMIT 10`
      );
      for (const r of raceRiders.rows ?? []) {
        if (r.name && !riderNames.includes(r.name)) riderNames.push(r.name);
      }
    }

    // Fallback: hardcode top classics names if no startlist data
    if (riderNames.length < 5) {
      riderNames.push(
        "Mathieu van der Poel", "Tadej Pogačar", "Wout van Aert",
        "Remco Evenepoel", "Tom Pidcock", "Arnaud De Lie", "Jasper Philipsen"
      );
    }

    console.log(`🚴 Checking intel for ${riderNames.length} riders...`);

    for (const riderName of riderNames.slice(0, limitArg)) {
      try {
        const articles = await fetchGoogleNews(`"${riderName}" cycling`, 3);
        for (const art of articles) {
          if (!isNew(art.url, existingIntel) && !isNew(art.url, newItems)) continue;
          const sentiment = scoreSentiment(art.title);
          const tags = extractTags(art.title);
          const item: IntelItem = {
            type: "rider",
            subject: riderName,
            title: art.title,
            url: art.url,
            publishedAt: art.publishedAt,
            source: art.source,
            sentiment,
            tags,
          };
          newItems.push(item);
          if (tags.length > 0 || Math.abs(sentiment) >= 0.3) {
            console.log(`   📰 ${riderName}: ${art.title.slice(0, 70)}... [${tags.join(",")}|${sentiment.toFixed(1)}]`);
          }
        }
        await new Promise((r) => setTimeout(r, 500)); // rate limit
      } catch (err) {
        console.error(`   ❌ ${riderName}: ${err}`);
      }
    }
  }

  // ── 2. Race intel ────────────────────────────────────────────────────────────
  if (doRaces) {
    let racesToCheck: Array<{ name: string; slug: string | null }> = [];

    if (raceSlugArg) {
      const [ev] = await db
        .select({ name: raceEvents.name, slug: raceEvents.slug })
        .from(raceEvents)
        .where(eq(raceEvents.slug, raceSlugArg))
        .limit(1);
      if (ev) racesToCheck = [ev];
    } else {
      // Upcoming races in next 7 days
      const todayStr = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const weekStr = nextWeek.toISOString().slice(0, 10);

      racesToCheck = await db
        .select({ name: raceEvents.name, slug: raceEvents.slug })
        .from(raceEvents)
        .where(and(gte(raceEvents.date, todayStr)))
        .limit(5);
    }

    console.log(`\n🏁 Checking intel for ${racesToCheck.length} races...`);

    for (const race of racesToCheck) {
      try {
        const articles = await fetchGoogleNews(`"${race.name}"`, 4);
        for (const art of articles) {
          if (!isNew(art.url, existingIntel) && !isNew(art.url, newItems)) continue;
          const sentiment = scoreSentiment(art.title);
          const tags = extractTags(art.title);
          const item: IntelItem = {
            type: "race",
            subject: race.name,
            title: art.title,
            url: art.url,
            publishedAt: art.publishedAt,
            source: art.source,
            sentiment,
            tags,
          };
          newItems.push(item);
          if (tags.length > 0 || Math.abs(sentiment) >= 0.25) {
            console.log(`   📰 ${race.name}: ${art.title.slice(0, 70)}... [${tags.join(",")}|${sentiment.toFixed(1)}]`);
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`   ❌ ${race.name}: ${err}`);
      }
    }
  }

  // ── 3. Persist new items ─────────────────────────────────────────────────────
  if (newItems.length > 0) {
    appendIntel(newItems);
    console.log(`\n✅ ${newItems.length} new intel items saved to ${INTEL_FILE}`);
  } else {
    console.log("\n✅ No new intel items.");
  }

  // ── 4. Feed high-signal rider items into gossip-hunter ───────────────────────
  const highSignal = newItems.filter(
    (i) => i.type === "rider" && (i.tags.includes("injury") || i.tags.includes("withdrawal") || Math.abs(i.sentiment ?? 0) >= 0.4)
  );

  if (highSignal.length > 0) {
    console.log(`\n🔔 Feeding ${highSignal.length} high-signal items into gossip-hunter...`);

    // Group by rider
    const byRider: Record<string, IntelItem[]> = {};
    for (const item of highSignal) {
      byRider[item.subject] = byRider[item.subject] || [];
      byRider[item.subject].push(item);
    }

    const gossipInput = Object.entries(byRider).map(([riderName, items]) => ({
      riderName,
      news: items.map((i) => ({
        title: i.title,
        snippet: i.title,
        source: i.source,
        url: i.url,
        date: i.publishedAt,
      })),
    }));

    const gossipJson = JSON.stringify(gossipInput);
    try {
      const result = execSync(
        `echo '${gossipJson.replace(/'/g, "'\\''")}' | node_modules/.bin/tsx scripts/agents/gossip-hunter.ts`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      console.log("   Gossip-hunter:", result.trim());
    } catch (err: any) {
      console.error("   Gossip-hunter error:", err.stderr || err.message);
    }
  }

  // ── 5. Summary for marketing agent ──────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Intel Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   New items today: ${newItems.length}`);
  console.log(`   High signal (fed to gossip): ${highSignal.length}`);
  console.log(`   Intel file: ${INTEL_FILE}`);
  const injuries = newItems.filter((i) => i.tags.includes("injury") || i.tags.includes("withdrawal"));
  if (injuries.length > 0) {
    console.log(`\n⚠️  ALERTS:`);
    for (const i of injuries) console.log(`   ${i.subject}: ${i.title.slice(0, 80)}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
