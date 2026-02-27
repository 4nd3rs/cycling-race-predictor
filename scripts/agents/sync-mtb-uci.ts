/**
 * Sync MTB UCI Rankings from XCOdata.com
 * Scrapes all 6 MTB ranking categories (Elite + U23 + Junior, M + W)
 * XCOdata uses official UCI points (verified match via Teunissen Van Manen 204pts).
 * No Playwright needed — static HTML tables.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 300 : 300;

const CATEGORIES = [
  { url: "https://www.xcodata.com/rankings/ME/", ageCategory: "elite",  gender: "men"   },
  { url: "https://www.xcodata.com/rankings/WE/", ageCategory: "elite",  gender: "women" },
  { url: "https://www.xcodata.com/rankings/MU/", ageCategory: "u23",    gender: "men"   },
  { url: "https://www.xcodata.com/rankings/WU/", ageCategory: "u23",    gender: "women" },
  { url: "https://www.xcodata.com/rankings/MJ/", ageCategory: "junior", gender: "men"   },
  { url: "https://www.xcodata.com/rankings/WJ/", ageCategory: "junior", gender: "women" },
];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normaliseName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return stripAccents(raw);
  const upper: string[] = [], first: string[] = [];
  for (const p of parts) {
    if (/^[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇÆŒ\-]+$/.test(p)) upper.push(p);
    else first.push(p);
  }
  if (!first.length) first.push(upper.pop()!);
  return stripAccents([...first, ...upper].join(" "));
}

interface RankEntry { rank: number; name: string; uciPoints: number; }

async function scrapeCategory(url: string, max: number): Promise<RankEntry[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const entries: RankEntry[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (entries.length >= max) break;
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/&nbsp;/g, "").replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank === 0) continue;
    let name = "", points = 0;
    for (const c of cells.slice(1)) {
      if (!name && /[A-Za-z]/.test(c) && c.includes(" ") && isNaN(Number(c))) name = c;
      const n = parseInt(c);
      if (!isNaN(n) && n > 10 && n < 15000) points = n;
    }
    if (name && points) entries.push({ rank, name, uciPoints: points });
  }
  return entries;
}

async function syncCategory(entries: RankEntry[], ageCategory: string, gender: string) {
  let updated = 0, notFound = 0;
  // Load all riders for matching
  const allRiders = await db.query.riders.findMany({ columns: { id: true, name: true } });
  const riderByNorm = new Map(allRiders.map(r => [normaliseName(r.name), r.id]));

  for (const entry of entries) {
    const norm = normaliseName(entry.name);
    let riderId = riderByNorm.get(norm);
    if (!riderId) {
      // partial match: all words in entry name present in rider name
      const words = norm.split(" ");
      for (const [rn, rid] of riderByNorm) {
        if (words.length >= 2 && words.every(w => rn.includes(w))) { riderId = rid; break; }
      }
    }
    if (!riderId) { notFound++; if (notFound <= 5) console.log(`  Not found: ${entry.name}`); continue; }

    const existing = await db.query.riderDisciplineStats.findFirst({
      where: and(eq(schema.riderDisciplineStats.riderId, riderId), eq(schema.riderDisciplineStats.discipline, "mtb"))
    });
    if (existing) {
      await db.update(schema.riderDisciplineStats)
        .set({ uciPoints: entry.uciPoints, uciRank: entry.rank })
        .where(eq(schema.riderDisciplineStats.id, existing.id));
    } else {
      await db.insert(schema.riderDisciplineStats).values({
        riderId, discipline: "mtb", ageCategory: ageCategory as any, gender: gender as any,
        uciPoints: entry.uciPoints, uciRank: entry.rank, currentElo: 1500,
      });
    }
    updated++;
  }
  return { updated, notFound };
}

async function main() {
  console.log(`\nMTB UCI Rankings Sync — XCOdata.com (limit: ${limit})\n`);
  let totalUpdated = 0, totalNotFound = 0;
  for (const cat of CATEGORIES) {
    const label = `${cat.ageCategory} ${cat.gender}`.padEnd(14);
    process.stdout.write(`${label}: `);
    try {
      const entries = await scrapeCategory(cat.url, limit);
      process.stdout.write(`${entries.length} entries → `);
      const { updated, notFound } = await syncCategory(entries, cat.ageCategory, cat.gender);
      console.log(`${updated} updated, ${notFound} not found`);
      totalUpdated += updated; totalNotFound += notFound;
    } catch (err: any) { console.log(`ERROR: ${err.message}`); }
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`\nDone: ${totalUpdated} updated, ${totalNotFound} not in DB`);
}
main().catch(e => { console.error(e); process.exit(1); });
