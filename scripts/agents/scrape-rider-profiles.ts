/**
 * scrape-rider-profiles.ts
 * Enriches rider profiles with Wikipedia bio + photo.
 * Usage: tsx scripts/agents/scrape-rider-profiles.ts [--race <race-id>] [--all-upcoming]
 *
 * Fetches riders from upcoming race startlists (next 14 days), searches Wikipedia,
 * pulls bio + photo URL, updates the riders table.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull, or, gte, and, inArray } from "drizzle-orm";
import { riders, races, raceStartlist, raceEvents } from "../../src/lib/db/schema";
import { chromium } from "playwright";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls?: { desktop: { page: string } };
}

async function searchWikipedia(name: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${name} cyclist`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&srlimit=3&srprop=snippet`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CyclingPredictor/1.0 (race-predictor-bot)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.query?.search ?? [];
    // Pick the best match — prefer exact name match
    const nameLower = name.toLowerCase();
    for (const r of results) {
      const titleLower = (r.title as string).toLowerCase();
      // Match if all words of the name appear in the title
      const words = nameLower.split(" ").filter((w: string) => w.length > 2);
      if (words.every((w: string) => titleLower.includes(w))) {
        return r.title as string;
      }
    }
    // Fallback: first result if it's a cycling article
    if (results.length > 0) {
      const snippet = (results[0].snippet as string).toLowerCase();
      if (/cycl|cyclist|velodrom|peloton|grand tour|classic/i.test(snippet)) {
        return results[0].title as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWikiSummary(title: string): Promise<WikiSummary | null> {
  try {
    const slug = encodeURIComponent(title.replace(/ /g, "_"));
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      {
        headers: { "User-Agent": "CyclingPredictor/1.0 (race-predictor-bot)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchPCSPhoto(pcsId: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`https://www.procyclingstats.com/rider/${pcsId}`, {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    const imgSrc = await page.$eval(
      'div.rdr-img-cont img, .rider-header img, img[src*="/images/riders/"]',
      (el: any) => el.src
    ).catch(() => null);
    return imgSrc ?? null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

async function fetchInstagramPhoto(handle: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(`https://www.instagram.com/${handle}/`, {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    // Try og:image meta tag
    const ogImage = await page.$eval(
      'meta[property="og:image"]',
      (el: any) => el.content
    ).catch(() => null);
    return ogImage ?? null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

function truncateBio(text: string, maxLen = 400): string {
  if (text.length <= maxLen) return text;
  // Truncate at sentence boundary
  const truncated = text.substring(0, maxLen);
  const lastDot = truncated.lastIndexOf(". ");
  return lastDot > 200 ? truncated.substring(0, lastDot + 1) : truncated + "…";
}

async function enrichRider(rider: { id: string; name: string; photoUrl: string | null; bio: string | null; wikiSlug: string | null; pcsId?: string | null; instagramHandle?: string | null }) {
  // Skip if already fully enriched
  if (rider.bio && rider.photoUrl) return false;

  // Photo-only enrichment via PCS or Instagram (if bio exists but photo missing)
  if (rider.bio && !rider.photoUrl) {
    let photoUrl: string | null = null;
    if (rider.pcsId) {
      console.log(`  📷 ${rider.name} — trying PCS photo...`);
      photoUrl = await fetchPCSPhoto(rider.pcsId);
    }
    if (!photoUrl && rider.instagramHandle) {
      console.log(`  📷 ${rider.name} — trying Instagram photo...`);
      photoUrl = await fetchInstagramPhoto(rider.instagramHandle);
    }
    if (photoUrl) {
      await db.update(riders).set({ photoUrl }).where(eq(riders.id, rider.id));
      console.log(`     ✅ Photo: ${photoUrl.substring(0, 80)}`);
      return true;
    }
  }

  console.log(`  🔍 ${rider.name}`);

  // Try existing wikiSlug first, or search for one
  let wikiTitle = rider.wikiSlug;
  if (!wikiTitle) {
    wikiTitle = await searchWikipedia(rider.name);
    if (!wikiTitle) {
      console.log(`     ⚠️ No Wikipedia article found`);
      return false;
    }
    console.log(`     📖 Found: "${wikiTitle}"`);
  }

  const summary = await fetchWikiSummary(wikiTitle);
  if (!summary) return false;

  const bio = summary.extract ? truncateBio(summary.extract) : null;
  const photoUrl = summary.thumbnail?.source || null;
  const pcsUrl = rider.pcsId ? `https://www.procyclingstats.com/rider/${rider.pcsId}` : null;

  await db
    .update(riders)
    .set({
      bio: bio || rider.bio,
      photoUrl: photoUrl || rider.photoUrl,
      wikiSlug: wikiTitle,
      ...(pcsUrl ? { pcsUrl } : {}),
    })
    .where(eq(riders.id, rider.id));

  if (bio) console.log(`     ✅ Bio: ${bio.substring(0, 80)}…`);
  if (photoUrl) console.log(`     📷 Photo: ${photoUrl.substring(0, 60)}…`);
  return true;
}

async function getRidersForUpcomingRaces(days = 14): Promise<Array<{ id: string; name: string; photoUrl: string | null; bio: string | null; wikiSlug: string | null; pcsId: string | null }>> {
  const today = new Date().toISOString().substring(0, 10);
  const future = new Date(Date.now() + days * 86400000).toISOString().substring(0, 10);

  // Get upcoming races
  const upcomingRaces = await db
    .select({ id: races.id })
    .from(races)
    .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(gte(races.date, today)));

  if (!upcomingRaces.length) return [];
  const raceIds = upcomingRaces.map((r) => r.id);

  // Get riders in those startlists who lack enrichment
  const startlistRiders = await db
    .selectDistinct({ 
      id: riders.id, 
      name: riders.name,
      photoUrl: riders.photoUrl,
      bio: riders.bio,
      wikiSlug: riders.wikiSlug,
      pcsId: riders.pcsId,
      instagramHandle: riders.instagramHandle,
    })
    .from(raceStartlist)
    .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
    .where(
      and(
        inArray(raceStartlist.raceId, raceIds.slice(0, 50)), // limit DB query
        or(isNull(riders.bio), isNull(riders.photoUrl))
      )
    )
    .limit(200);

  return startlistRiders;
}

async function main() {
  const args = process.argv.slice(2);
  const raceId = args.find((a, i) => args[i - 1] === "--race");
  const allUpcoming = args.includes("--all-upcoming");
  const limit = parseInt(args.find((a, i) => args[i - 1] === "--limit") ?? "50");

  console.log("\n🎯 Rider Profile Enricher\n");

  let targetRiders: Array<{ id: string; name: string; photoUrl: string | null; bio: string | null; wikiSlug: string | null; pcsId: string | null }>;

  if (raceId) {
    // Specific race
    targetRiders = await db
      .selectDistinct({
        id: riders.id,
        name: riders.name,
        photoUrl: riders.photoUrl,
        bio: riders.bio,
        wikiSlug: riders.wikiSlug,
        pcsId: riders.pcsId,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .where(eq(raceStartlist.raceId, raceId))
      .limit(limit);
  } else {
    // Upcoming races (default)
    targetRiders = await getRidersForUpcomingRaces(14);
    targetRiders = targetRiders.slice(0, limit);
  }

  console.log(`Found ${targetRiders.length} riders to enrich\n`);

  let enriched = 0;
  let skipped = 0;

  for (const rider of targetRiders) {
    const ok = await enrichRider(rider);
    if (ok) enriched++;
    else skipped++;
    // Rate limit: 1 req/sec to Wikipedia
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(`\n✅ Done. Enriched: ${enriched}, Skipped/Not found: ${skipped}`);
}

main().catch(console.error);
