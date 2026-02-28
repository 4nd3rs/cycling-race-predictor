/**
 * scrape-sources.ts
 *
 * Aggregates cycling intel from multiple free sources:
 *   - Reddit (r/peloton, r/cycling) — community intel, breaking news
 *   - Google News RSS — aggregated media
 *   - VeloNews / CyclingWeekly / CyclingUpToDate RSS — specialist press
 *
 * Saves to data/intel/YYYY-MM-DD.jsonl (agent-only).
 * High-signal items → gossip-hunter → DB + follower notifications.
 *
 * Usage:
 *   tsx scripts/agents/scrape-sources.ts [--race-slug <slug>] [--limit <n>]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { db, races, raceEvents } from "./lib/db";
import { gte, and, eq } from "drizzle-orm";

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1] || "10") : 10;
const raceSlugArg = args.includes("--race-slug") ? args[args.indexOf("--race-slug") + 1] : null;

// ─── Intel storage ─────────────────────────────────────────────────────────────
const INTEL_DIR = "./data/intel";
const today = new Date().toISOString().slice(0, 10);
const INTEL_FILE = `${INTEL_DIR}/${today}.jsonl`;

export interface IntelItem {
  source_type: "reddit" | "rss" | "google_news";
  source_name: string;
  type: "rider" | "race" | "general";
  subject: string;
  title: string;
  body?: string;
  url: string;
  publishedAt: string;
  sentiment: number;
  tags: string[];
  score?: number; // Reddit upvotes
}

function loadTodayIntel(): IntelItem[] {
  if (!existsSync(INTEL_FILE)) return [];
  return readFileSync(INTEL_FILE, "utf-8")
    .split("\n").filter(Boolean)
    .map((l) => JSON.parse(l));
}

function appendIntel(items: IntelItem[]) {
  if (!existsSync(INTEL_DIR)) mkdirSync(INTEL_DIR, { recursive: true });
  const existing = existsSync(INTEL_FILE) ? readFileSync(INTEL_FILE, "utf-8").split("\n").filter(Boolean) : [];
  const existingUrls = new Set(existing.map((l) => { try { return JSON.parse(l).url; } catch { return ""; } }));
  const newLines = items.filter((i) => !existingUrls.has(i.url)).map((i) => JSON.stringify(i));
  if (newLines.length > 0) {
    writeFileSync(INTEL_FILE, existing.join("\n") + (existing.length ? "\n" : "") + newLines.join("\n") + "\n");
  }
  return newLines.length;
}

// ─── Sentiment / Tags ─────────────────────────────────────────────────────────
const NEG = ["injur","ill","sick","crash","abandon","dns","dnf","withdraw","out of","misses","ruled out","blow","concern","doubt","broken","fracture","fell","fever","virus","positive test","suspended","ban"];
const POS = ["win","victor","podium","form","strong","confident","ready","comeback","great","impressive","favourite","favorite","unstoppable","dominate","flying","incredible"];

function scoreSentiment(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of NEG) if (t.includes(w)) s -= 0.3;
  for (const w of POS) if (t.includes(w)) s += 0.25;
  return Math.max(-1, Math.min(1, s));
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  if (/injur|crash|ill|sick|broken|fracture|fever|virus/i.test(text)) tags.push("injury");
  if (/withdraw|dns|abandon|out of|misses|ruled out|suspended/i.test(text)) tags.push("withdrawal");
  if (/transfer|sign|team change|moving to/i.test(text)) tags.push("transfer");
  if (/win|victor|podium|flying|dominate/i.test(text)) tags.push("form");
  if (/preview|prediction|favourite|favorite|start.?list/i.test(text)) tags.push("preview");
  if (/result|finish|stage|classification/i.test(text)) tags.push("result");
  return tags;
}

// ─── Source: Reddit ───────────────────────────────────────────────────────────
async function scrapeReddit(subreddit: string, query: string, subject: string, type: "rider" | "race" | "general"): Promise<IntelItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=10&restrict_sr=1&t=week`;
  const res = await fetch(url, {
    headers: { "User-Agent": "PCP-Intel-Bot/1.0 (procyclingpredictor.com)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json() as any;
  const posts = data?.data?.children || [];

  return posts
    .filter((p: any) => p.data?.score >= 2) // skip low-karma posts
    .map((p: any) => {
      const d = p.data;
      const text = `${d.title} ${d.selftext?.slice(0, 200) ?? ""}`;
      return {
        source_type: "reddit" as const,
        source_name: `r/${subreddit}`,
        type,
        subject,
        title: d.title,
        body: d.selftext?.slice(0, 300) || undefined,
        url: `https://reddit.com${d.permalink}`,
        publishedAt: new Date(d.created_utc * 1000).toISOString(),
        sentiment: scoreSentiment(text),
        tags: extractTags(text),
        score: d.score,
      };
    });
}

// ─── Source: RSS Feed ─────────────────────────────────────────────────────────
async function scrapeRSS(feedUrl: string, sourceName: string, filterTerms: string[]): Promise<IntelItem[]> {
  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "PCP-Intel-Bot/1.0 (procyclingpredictor.com)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const xml = await res.text();

  const items: IntelItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of blocks.slice(0, 20)) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const linkMatch  = block.match(/<link>(https?:\/\/[^<\s]+)/);
    const descMatch  = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const dateMatch  = block.match(/<pubDate>(.*?)<\/pubDate>/);

    const title = titleMatch?.[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() ?? "";
    const link  = linkMatch?.[1] ?? "";
    const desc  = descMatch?.[1]?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").slice(0, 200) ?? "";
    const pub   = dateMatch?.[1] ?? new Date().toISOString();

    if (!title || !link) continue;

    const text = `${title} ${desc}`.toLowerCase();
    if (filterTerms.length > 0 && !filterTerms.some((t) => text.includes(t.toLowerCase()))) continue;

    items.push({
      source_type: "rss",
      source_name: sourceName,
      type: "general",
      subject: "cycling",
      title: title.replace(/ - [^-]{0,30}$/, "").trim(),
      body: desc || undefined,
      url: link,
      publishedAt: pub,
      sentiment: scoreSentiment(title + " " + desc),
      tags: extractTags(title + " " + desc),
    });
  }
  return items;
}

// ─── Source: Google News RSS ──────────────────────────────────────────────────
async function scrapeGoogleNews(query: string, subject: string, type: "rider" | "race" | "general"): Promise<IntelItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const xml = await res.text();

  const items: IntelItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of blocks.slice(0, 5)) {
    const title   = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) || block.match(/<title>(.*?)<\/title>/))?.[1] ?? "";
    const link    = block.match(/<link>(https?:\/\/[^<\s]+)/)?.[1] ?? "";
    const pub     = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    const source  = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? "Google News";
    if (!title || !link) continue;

    items.push({
      source_type: "google_news",
      source_name: source,
      type,
      subject,
      title: title.replace(/ - [^-]{0,30}$/, "").trim(),
      url: link,
      publishedAt: pub,
      sentiment: scoreSentiment(title),
      tags: extractTags(title),
    });
  }
  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const existing = loadTodayIntel();
  const allNew: IntelItem[] = [];

  console.log(`\n📡 Source Scraper — ${today}`);
  console.log(`   Existing items today: ${existing.length}\n`);

  // ── 1. Upcoming races (next 7 days) ───────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
  const weekStr  = nextWeek.toISOString().slice(0, 10);

  let eventFilter: Array<{ name: string; slug: string | null }> = [];
  if (raceSlugArg) {
    const [ev] = await db.select({ name: raceEvents.name, slug: raceEvents.slug })
      .from(raceEvents).where(eq(raceEvents.slug, raceSlugArg)).limit(1);
    if (ev) eventFilter = [ev];
  } else {
    eventFilter = await db.select({ name: raceEvents.name, slug: raceEvents.slug })
      .from(raceEvents).where(gte(raceEvents.date, todayStr)).limit(5);
  }

  // ── 2. Race intel ─────────────────────────────────────────────────────────
  console.log(`🏁 Race intel for ${eventFilter.length} events...`);
  for (const ev of eventFilter) {
    const shortName = ev.name.split(" ").slice(0, 3).join(" "); // e.g. "Omloop Het Nieuwsblad"

    // Reddit r/peloton
    const reddit1 = await scrapeReddit("peloton", shortName, ev.name, "race");
    const reddit2 = await scrapeReddit("cycling", shortName, ev.name, "race");
    // Google News
    const gnews = await scrapeGoogleNews(`"${shortName}" 2026`, ev.name, "race");

    const raceItems = [...reddit1, ...reddit2, ...gnews];
    if (raceItems.length > 0) console.log(`   ${ev.name}: ${raceItems.length} items (Reddit: ${reddit1.length + reddit2.length}, GNews: ${gnews.length})`);
    allNew.push(...raceItems);

    await new Promise((r) => setTimeout(r, 600));
  }

  // ── 3. General cycling RSS feeds ─────────────────────────────────────────
  console.log(`\n📰 RSS feeds...`);
  const raceKeywords = eventFilter.map((e) => e.name.split(" ")[0]);

  const feeds = [
    { url: "https://www.velonews.com/feed/",            name: "VeloNews" },
    { url: "https://www.cyclingweekly.com/feed",        name: "CyclingWeekly" },
    { url: "https://www.cyclingnews.com/feeds.xml",     name: "CyclingNews" },
    { url: "https://www.cyclinguptodate.com/feed",      name: "CyclingUpToDate" },
    { url: "https://www.wielerflits.nl/feed/",          name: "Wielerflits" },
  ];

  for (const feed of feeds) {
    try {
      const items = await scrapeRSS(feed.url, feed.name, raceKeywords);
      if (items.length > 0) console.log(`   ${feed.name}: ${items.length} relevant items`);
      allNew.push(...items);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ ${feed.name}: ${err}`);
    }
  }

  // ── 4. Reddit general cycling discussion ─────────────────────────────────
  console.log(`\n💬 Reddit r/peloton general...`);
  for (const ev of eventFilter) {
    const shortName = ev.name.split(" ").slice(0, 3).join(" ");
    const threadItems = await scrapeReddit("peloton", `${shortName} race thread OR megathread OR discussion`, ev.name, "race");
    allNew.push(...threadItems);
  }

  // ── 5. Persist ───────────────────────────────────────────────────────────
  const saved = appendIntel(allNew);
  console.log(`\n✅ ${saved} new intel items saved (${allNew.length - saved} dupes skipped)`);

  // ── 6. High-signal → gossip-hunter ───────────────────────────────────────
  const highSignal = allNew.filter(
    (i) => i.type === "rider" && (i.tags.includes("injury") || i.tags.includes("withdrawal") || Math.abs(i.sentiment) >= 0.4)
  );

  if (highSignal.length > 0) {
    console.log(`\n🔔 ${highSignal.length} high-signal rider items → gossip-hunter`);
    const byRider: Record<string, IntelItem[]> = {};
    for (const i of highSignal) { byRider[i.subject] = byRider[i.subject] || []; byRider[i.subject].push(i); }
    const gossipInput = Object.entries(byRider).map(([name, items]) => ({
      riderName: name,
      news: items.map((i) => ({ title: i.title, snippet: i.body || i.title, source: i.source_name, url: i.url, date: i.publishedAt })),
    }));
    try {
      const r = execSync(
        `echo '${JSON.stringify(gossipInput).replace(/'/g, "'\\''")}' | node_modules/.bin/tsx scripts/agents/gossip-hunter.ts`,
        { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }
      );
      console.log("   Gossip:", r.trim().split("\n").pop());
    } catch (e: any) { console.error("   Gossip error:", e.stderr?.slice(0, 100)); }
  }

  // ── 7. Summary ───────────────────────────────────────────────────────────
  const allToday = loadTodayIntel();
  const bySource: Record<string, number> = {};
  for (const i of allToday) bySource[i.source_name] = (bySource[i.source_name] || 0) + 1;
  const alerts = allToday.filter((i) => i.tags.includes("injury") || i.tags.includes("withdrawal"));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Intel Summary — ${today}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Total items today: ${allToday.length}`);
  for (const [src, cnt] of Object.entries(bySource).sort((a,b) => b[1]-a[1])) {
    console.log(`   ${src.padEnd(20)} ${cnt}`);
  }
  if (alerts.length > 0) {
    console.log(`\n⚠️  ALERTS (${alerts.length}):`);
    for (const a of alerts.slice(0, 5)) console.log(`   [${a.source_name}] ${a.subject}: ${a.title.slice(0, 80)}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
