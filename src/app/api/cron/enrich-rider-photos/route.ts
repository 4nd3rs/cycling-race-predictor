import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { db, riders, raceResults, raceStartlist, races } from "@/lib/db";
import { and, eq, isNull, gte, lte } from "drizzle-orm";
import { scrapeRider } from "@/lib/scraper/pcs";

export const maxDuration = 120;

// ── Wikipedia API helpers ───────────────────────────────────────────────────

interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
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

    const nameLower = name.toLowerCase();
    for (const r of results) {
      const titleLower = (r.title as string).toLowerCase();
      const words = nameLower.split(" ").filter((w: string) => w.length > 2);
      if (words.every((w: string) => titleLower.includes(w))) {
        return r.title as string;
      }
    }
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

function truncateBio(text: string, maxLen = 400): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastDot = truncated.lastIndexOf(". ");
  return lastDot > 200 ? truncated.substring(0, lastDot + 1) : truncated + "…";
}

// ── XCOdata photo helper ────────────────────────────────────────────────────

async function fetchXcodataPhoto(xcoId: string): Promise<string | null> {
  // XCOdata stores rider photos at a predictable CDN URL
  // Try current year first, then previous year
  const currentYear = new Date().getFullYear();
  for (const year of [currentYear, currentYear - 1]) {
    const url = `https://cdn.xcodata.com/static/images/riders/${year}/${xcoId}.jpg`;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return url;
    } catch {
      // continue to next year
    }
  }
  return null;
}

// ── PCS photo helper ────────────────────────────────────────────────────────

async function fetchPcsPhoto(pcsId: string): Promise<string | null> {
  try {
    const rider = await scrapeRider(pcsId);
    return rider?.photoUrl ?? null;
  } catch {
    return null;
  }
}

// ── Find riders needing photos ──────────────────────────────────────────────

interface RiderToEnrich {
  id: string;
  name: string;
  wikiSlug: string | null;
  bio: string | null;
  xcoId: string | null;
  pcsId: string | null;
  discipline: string | null;
}

async function getRidersNeedingPhotos(): Promise<RiderToEnrich[]> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fourteenDaysAhead = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  // 1. Top 3 finishers from recent results (last 30 days) without photos
  const recentTopFinishers = await db
    .selectDistinct({
      id: riders.id,
      name: riders.name,
      wikiSlug: riders.wikiSlug,
      bio: riders.bio,
      xcoId: riders.xcoId,
      pcsId: riders.pcsId,
      discipline: races.discipline,
    })
    .from(raceResults)
    .innerJoin(riders, eq(raceResults.riderId, riders.id))
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .where(
      and(
        isNull(riders.photoUrl),
        lte(raceResults.position, 3),
        gte(races.date, thirtyDaysAgo),
        lte(races.date, today)
      )
    )
    .limit(30);

  // 2. Riders in upcoming startlists (next 14 days) without photos
  const upcomingStartlistRiders = await db
    .selectDistinct({
      id: riders.id,
      name: riders.name,
      wikiSlug: riders.wikiSlug,
      bio: riders.bio,
      xcoId: riders.xcoId,
      pcsId: riders.pcsId,
      discipline: races.discipline,
    })
    .from(raceStartlist)
    .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
    .innerJoin(races, eq(raceStartlist.raceId, races.id))
    .where(
      and(
        isNull(riders.photoUrl),
        gte(races.date, today),
        lte(races.date, fourteenDaysAhead),
        eq(races.status, "active")
      )
    )
    .limit(30);

  // Merge and dedupe, prioritizing recent top finishers
  const seen = new Set<string>();
  const merged: RiderToEnrich[] = [];

  for (const r of recentTopFinishers) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  for (const r of upcomingStartlistRiders) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  return merged.slice(0, 40);
}

// ── Enrich a single rider ───────────────────────────────────────────────────

async function enrichRider(rider: RiderToEnrich): Promise<"photo" | "bio_only" | "not_found"> {
  let photoUrl: string | null = null;
  let bio: string | null = null;
  let wikiSlug: string | null = rider.wikiSlug;

  // Source 1: Wikipedia (free, no API key, gets both photo + bio)
  const wikiTitle = rider.wikiSlug ?? (await searchWikipedia(rider.name));
  if (wikiTitle) {
    wikiSlug = wikiTitle;
    const summary = await fetchWikiSummary(wikiTitle);
    if (summary) {
      photoUrl = summary.thumbnail?.source ?? null;
      if (summary.extract && !rider.bio) {
        bio = truncateBio(summary.extract);
      }
    }
  }

  // Source 2: XCOdata (for MTB riders with xcoId, free CDN URL)
  if (!photoUrl && rider.xcoId) {
    photoUrl = await fetchXcodataPhoto(rider.xcoId);
  }

  // Source 3: PCS (for road riders with pcsId, costs scrape.do credits)
  if (!photoUrl && rider.pcsId) {
    photoUrl = await fetchPcsPhoto(rider.pcsId);
  }

  // Build update
  const updates: Record<string, string | Date> = {};
  if (photoUrl) updates.photoUrl = photoUrl;
  if (bio && !rider.bio) updates.bio = bio;
  if (wikiSlug && !rider.wikiSlug) updates.wikiSlug = wikiSlug;

  if (Object.keys(updates).length === 0) return "not_found";

  updates.updatedAt = new Date();
  await db.update(riders).set(updates).where(eq(riders.id, rider.id));

  return photoUrl ? "photo" : "bio_only";
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ridersToEnrich = await getRidersNeedingPhotos();

    let photosAdded = 0;
    let notFound = 0;

    for (const rider of ridersToEnrich) {
      const result = await enrichRider(rider);
      if (result === "photo") photosAdded++;
      else if (result === "not_found") notFound++;

      // Rate limit: be respectful to Wikipedia + scrape.do
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(
      `[enrich-rider-photos] Processed ${ridersToEnrich.length} riders: ${photosAdded} photos added, ${notFound} not found`
    );

    return NextResponse.json({
      success: true,
      processed: ridersToEnrich.length,
      photosAdded,
      notFound,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[enrich-rider-photos]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
