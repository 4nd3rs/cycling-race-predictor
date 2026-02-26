/**
 * enrich-riders.ts — Comprehensive rider profile enricher
 *
 * For each rider missing data:
 *   1. Scrape their PCS page (Playwright) → Instagram handle, nationality, photo fallback
 *   2. Fetch Wikipedia → bio + photo
 *   3. Propagate data from proper-name twin to ALL_CAPS/PCS-import twin (same pcsId)
 *
 * Usage:
 *   tsx scripts/agents/enrich-riders.ts [--ids id1,id2,...] [--all-missing] [--no-browser]
 *   tsx scripts/agents/enrich-riders.ts --ids e1fb9b69,47f072e7,b9aa371e   (specific riders)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../../src/lib/db/schema";
import { eq, isNull, or, and } from "drizzle-orm";
import { chromium } from "playwright";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const idArg = args.find((a, i) => args[i - 1] === "--ids") ?? null;
const targetIds = idArg ? idArg.split(",").map(s => s.trim()) : null;
const allMissing = args.includes("--all-missing");
const noBrowser = args.includes("--no-browser");
const limit = parseInt(args.find((a, i) => args[i - 1] === "--limit") ?? "100");

// ─── Wikipedia ───────────────────────────────────────────────────────────────

async function searchWikipedia(name: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${name} cyclist`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&srlimit=3&srprop=snippet`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CyclingPredictor/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results: Array<{ title: string; snippet: string }> = data.query?.search ?? [];
    const nameLower = name.toLowerCase();
    const words = nameLower.split(" ").filter(w => w.length > 2);
    for (const r of results) {
      const titleLower = r.title.toLowerCase();
      if (words.every(w => titleLower.includes(w))) return r.title;
    }
    if (results[0] && /cycl|cyclist|peloton|grand tour|classic/i.test(results[0].snippet)) {
      return results[0].title;
    }
    return null;
  } catch { return null; }
}

async function fetchWikiSummary(title: string): Promise<{ bio: string | null; photoUrl: string | null }> {
  try {
    const slug = encodeURIComponent(title.replace(/ /g, "_"));
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { headers: { "User-Agent": "CyclingPredictor/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { bio: null, photoUrl: null };
    const data = await res.json();
    const bio = data.extract ? truncate(data.extract, 450) : null;
    const photoUrl = data.thumbnail?.source ?? null;
    return { bio, photoUrl };
  } catch { return { bio: null, photoUrl: null }; }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const t = text.substring(0, max);
  const dot = t.lastIndexOf(". ");
  return dot > 200 ? t.substring(0, dot + 1) : t + "…";
}

// ─── PCS scraper (Instagram + photo fallback) ─────────────────────────────────

async function scrapePcsRiderPage(
  pcsId: string,
  browser: import("playwright").Browser
): Promise<{ instagram: string | null; photoUrl: string | null; nationality: string | null }> {
  const url = `https://www.procyclingstats.com/rider/${pcsId}`;
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      let instagram: string | null = null;
      let photoUrl: string | null = null;
      let nationality: string | null = null;

      // Instagram: look for instagram.com links
      document.querySelectorAll("a[href*='instagram.com']").forEach(el => {
        const href = el.getAttribute("href") ?? "";
        const m = href.match(/instagram\.com\/([^/?#]+)/);
        if (m && m[1] && m[1] !== "p" && !instagram) instagram = m[1];
      });

      // Also check for icon links (some PCS pages use <i class="instagram-icon"> inside <a>)
      if (!instagram) {
        document.querySelectorAll("a").forEach(el => {
          const icon = el.querySelector("[class*='instagram'], [class*='ig']");
          if (icon) {
            const href = el.getAttribute("href") ?? "";
            const m = href.match(/instagram\.com\/([^/?#]+)/) || href.match(/^@?([a-zA-Z0-9._]+)$/);
            if (m && m[1] && !instagram) instagram = m[1];
          }
        });
      }

      // Photo: rider profile image on PCS
      const img = document.querySelector(".rdr-img img, img.rdrphoto, .rider-info img, img[src*='rider']") as HTMLImageElement | null;
      if (img) {
        const src = img.src;
        if (src && !src.includes("noavatar") && !src.includes("placeholder") && src.includes("procyclingstats")) {
          photoUrl = src;
        }
      }

      // Nationality: from the flag icon or breadcrumb
      const natFlag = document.querySelector(".rdr-country img, .info-body img[title], .rdrflag");
      if (natFlag) {
        nationality = natFlag.getAttribute("title") ?? natFlag.getAttribute("alt") ?? null;
      }

      return { instagram, photoUrl, nationality };
    });

    return data;
  } catch (err: any) {
    console.log(`     ⚠️ PCS scrape failed: ${err.message?.substring(0, 60)}`);
    return { instagram: null, photoUrl: null, nationality: null };
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Propagate data from twin rider ──────────────────────────────────────────

async function propagateFromTwin(rider: typeof schema.riders.$inferSelect): Promise<boolean> {
  if (!rider.pcsId) return false;

  // Find other riders with the same pcsId (or normalised name match)
  const others = await db.select().from(schema.riders)
    .where(and(eq(schema.riders.pcsId, rider.pcsId)));

  const twins = others.filter(r => r.id !== rider.id);
  if (twins.length === 0) return false;

  // Find the richest twin (most data)
  const rich = twins.sort((a, b) => {
    const scoreA = (a.photoUrl ? 2 : 0) + (a.bio ? 2 : 0) + (a.instagramHandle ? 1 : 0);
    const scoreB = (b.photoUrl ? 2 : 0) + (b.bio ? 2 : 0) + (b.instagramHandle ? 1 : 0);
    return scoreB - scoreA;
  })[0];

  const updates: Partial<typeof schema.riders.$inferInsert> = {};
  if (!rider.photoUrl && rich.photoUrl) updates.photoUrl = rich.photoUrl;
  if (!rider.bio && rich.bio) updates.bio = rich.bio;
  if (!rider.wikiSlug && rich.wikiSlug) updates.wikiSlug = rich.wikiSlug;
  if (!rider.instagramHandle && rich.instagramHandle) updates.instagramHandle = rich.instagramHandle;

  if (Object.keys(updates).length === 0) return false;

  await db.update(schema.riders).set(updates).where(eq(schema.riders.id, rider.id));
  console.log(`     ↩️  Copied from twin "${rich.name}": ${Object.keys(updates).join(", ")}`);
  return true;
}

// ─── Enrich one rider ────────────────────────────────────────────────────────

async function enrichRider(
  rider: typeof schema.riders.$inferSelect,
  browser: import("playwright").Browser | null
): Promise<{ changed: boolean; steps: string[] }> {
  const steps: string[] = [];
  const updates: Partial<typeof schema.riders.$inferInsert> = {};

  console.log(`\n  🔍 ${rider.name} (${rider.pcsId ?? "no pcsId"})`);

  // Step 1: propagate from twin (same pcsId, different name format)
  if (rider.pcsId && (!rider.photoUrl || !rider.bio || !rider.instagramHandle)) {
    const propagated = await propagateFromTwin(rider);
    if (propagated) {
      // Reload to get fresh data
      const fresh = await db.query.riders.findFirst({ where: eq(schema.riders.id, rider.id) });
      if (fresh) {
        rider = fresh;
        steps.push("twin-propagated");
      }
    }
  }

  // Step 2: PCS scrape for Instagram handle (+ photo fallback)
  if (browser && rider.pcsId && !rider.instagramHandle) {
    const pcs = await scrapePcsRiderPage(rider.pcsId, browser);
    if (pcs.instagram) {
      updates.instagramHandle = pcs.instagram;
      steps.push(`instagram:@${pcs.instagram}`);
      console.log(`     📸 Instagram: @${pcs.instagram}`);
    }
    if (!rider.photoUrl && pcs.photoUrl) {
      updates.photoUrl = pcs.photoUrl;
      steps.push("photo:pcs");
      console.log(`     📷 Photo from PCS`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  // Step 3: Wikipedia for bio + photo
  if (!rider.bio || !rider.photoUrl) {
    let wikiTitle = rider.wikiSlug;
    if (!wikiTitle) {
      // Normalise name for search (PCS format is "LAST First" — convert)
      const searchName = rider.name.includes(" ")
        ? rider.name.split(" ").map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ")
        : rider.name;
      wikiTitle = await searchWikipedia(searchName);
    }

    if (wikiTitle) {
      const { bio, photoUrl } = await fetchWikiSummary(wikiTitle);
      if (bio && !rider.bio) {
        updates.bio = bio;
        updates.wikiSlug = wikiTitle;
        steps.push("bio:wiki");
        console.log(`     📖 Bio from Wikipedia "${wikiTitle}"`);
      }
      if (photoUrl && !rider.photoUrl && !(updates.photoUrl)) {
        updates.photoUrl = photoUrl;
        steps.push("photo:wiki");
        console.log(`     📷 Photo from Wikipedia`);
      }
      if (!rider.wikiSlug && wikiTitle) updates.wikiSlug = wikiTitle;
    } else {
      console.log(`     ⚠️  No Wikipedia match`);
      steps.push("wiki-not-found");
    }
    await new Promise(r => setTimeout(r, 1200));
  }

  if (Object.keys(updates).length > 0) {
    await db.update(schema.riders).set(updates).where(eq(schema.riders.id, rider.id));
  }

  const changed = steps.some(s => !s.includes("not-found"));
  if (!changed) console.log(`     ✅ Already complete — nothing to update`);
  return { changed, steps };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🎯 Rider Profile Enricher\n─────────────────────────────");

  let riders: (typeof schema.riders.$inferSelect)[] = [];

  if (targetIds) {
    // Fetch specific riders by partial ID match
    const all = await db.select().from(schema.riders);
    riders = all.filter(r => targetIds.some(id => r.id.startsWith(id)));
    console.log(`Targeting ${riders.length} specific rider(s)`);
  } else if (allMissing) {
    // All riders missing photo OR bio OR instagram
    riders = await db.select().from(schema.riders)
      .where(or(isNull(schema.riders.photoUrl), isNull(schema.riders.bio), isNull(schema.riders.instagramHandle)))
      .limit(limit);
    console.log(`Found ${riders.length} riders missing data`);
  } else {
    // Default: riders in upcoming race startlists missing data
    const today = new Date().toISOString().split("T")[0];
    const upcoming = await db
      .selectDistinct({ id: schema.riders.id })
      .from(schema.raceStartlist)
      .innerJoin(schema.races, eq(schema.raceStartlist.raceId, schema.races.id))
      .innerJoin(schema.riders, eq(schema.raceStartlist.riderId, schema.riders.id))
      .where(and(
        eq(schema.races.status, "active"),
        or(isNull(schema.riders.photoUrl), isNull(schema.riders.instagramHandle))
      ));
    const ids = upcoming.map(r => r.id).slice(0, limit);
    if (ids.length > 0) {
      riders = await db.select().from(schema.riders)
        .where(or(...ids.map(id => eq(schema.riders.id, id))));
    }
    console.log(`Found ${riders.length} upcoming-race riders missing data`);
  }

  if (riders.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let browser: import("playwright").Browser | null = null;
  if (!noBrowser) {
    browser = await chromium.launch({ headless: true });
  }

  let enriched = 0;
  let skipped = 0;

  try {
    for (const rider of riders) {
      const { changed } = await enrichRider(rider, browser);
      if (changed) enriched++;
      else skipped++;
    }
  } finally {
    await browser?.close();
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✅ Done. Enriched: ${enriched}, No change: ${skipped}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
