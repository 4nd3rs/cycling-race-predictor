/**
 * One-shot: import Omloop Het Nieuwsblad WE 2026 startlist + generate predictions
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, ilike } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium } from "playwright";
import { randomUUID } from "crypto";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const RACE_ID = "f6f9ae0b-13ef-4f29-accf-35719f187ccf";
const PCS_URL = "https://www.procyclingstats.com/race/omloop-het-nieuwsblad-we/2026/startlist";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function findOrCreateTeam(name: string): Promise<string> {
  const ex = await db.query.teams.findFirst({ where: ilike(schema.teams.name, name) });
  if (ex) return ex.id;
  const [r] = await db.insert(schema.teams).values({ name, discipline: "road" }).returning({ id: schema.teams.id });
  return r.id;
}

async function findOrCreateRider(name: string, pcsId: string, teamId: string): Promise<string> {
  if (pcsId) {
    const byId = await db.query.riders.findFirst({ where: eq(schema.riders.pcsId, pcsId) });
    if (byId) {
      await db.update(schema.riders).set({ teamId }).where(eq(schema.riders.id, byId.id));
      return byId.id;
    }
  }
  // Try name match
  const clean = stripAccents(name);
  const all = await db.select({ id: schema.riders.id, name: schema.riders.name }).from(schema.riders).limit(5000);
  const match = all.find(r => stripAccents(r.name) === clean);
  if (match) {
    await db.update(schema.riders).set({ pcsId, teamId }).where(eq(schema.riders.id, match.id));
    return match.id;
  }
  // Create
  const [r] = await db.insert(schema.riders).values({ name, pcsId, teamId, nationality: null }).returning({ id: schema.riders.id });
  return r.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚴 Scraping Women's Omloop startlist from PCS...");

  const browser = await chromium.launch({ headless: true });
  let rawEntries: { riderName: string; riderPcsId: string; teamName: string }[] = [];

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto(PCS_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    rawEntries = await page.evaluate(() => {
      const out: { riderName: string; riderPcsId: string; teamName: string }[] = [];
      document.querySelectorAll(".startlist_v4 > li").forEach((teamEl) => {
        // Team links may be relative ("team/...") or absolute ("/team/...")
        const teamLink = teamEl.querySelector("a[href*='team/']") as HTMLAnchorElement | null;
        const teamName = teamLink?.textContent?.trim() ?? teamEl.querySelector("b")?.textContent?.trim() ?? "";
        teamEl.querySelectorAll(".ridersCont li").forEach((riderEl) => {
          // Rider links may be relative ("rider/...") or absolute ("/rider/...")
          const link = riderEl.querySelector("a[href*='rider/']") as HTMLAnchorElement | null;
          if (!link) return;
          const riderName = link.textContent?.trim() ?? "";
          const href = link.getAttribute("href") ?? "";
          // Extract pcsId from either "rider/lotte-claes" or "/rider/lotte-claes"
          const riderPcsId = href.replace(/^\//, "").split("rider/")[1]?.split("/")[0] ?? "";
          const bibEl = riderEl.querySelector(".bib");
          if (riderName && riderPcsId) out.push({ riderName, riderPcsId, teamName });
        });
      });
      return out;
    });

    console.log(`  Found ${rawEntries.length} riders in ${new Set(rawEntries.map(r => r.teamName)).size} teams`);
    if (rawEntries.length > 0) {
      console.log(`  Sample: ${rawEntries.slice(0, 3).map(r => r.riderName).join(", ")}`);
    }
  } finally {
    await browser.close();
  }

  if (rawEntries.length === 0) {
    console.error("❌ No riders found — aborting");
    process.exit(1);
  }

  console.log("\n💾 Inserting startlist into DB...");
  let inserted = 0, skipped = 0;

  for (const entry of rawEntries) {
    const teamId = await findOrCreateTeam(entry.teamName || "Unknown");
    const riderId = await findOrCreateRider(entry.riderName, entry.riderPcsId, teamId);

    const existing = await db.query.raceStartlist.findFirst({
      where: and(eq(schema.raceStartlist.raceId, RACE_ID), eq(schema.raceStartlist.riderId, riderId)),
    });

    if (!existing) {
      await db.insert(schema.raceStartlist).values({ raceId: RACE_ID, riderId, teamId });
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`  ✅ Inserted: ${inserted}, already existed: ${skipped}`);
  console.log(`  Total in startlist: ${inserted + skipped}`);
}

main().catch(console.error).finally(() => process.exit(0));
