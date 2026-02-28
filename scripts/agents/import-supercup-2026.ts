/**
 * import-supercup-2026.ts  
 * Imports La Nucia + Banyoles 2026 Supercup results from parsed JSON.
 * Usage: tsx scripts/agents/import-supercup-2026.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { ilike, eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import * as fs from "fs";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const DRY_RUN = process.argv.includes("--dry-run");

function normalizeRiderName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");
  const isUpperCase = (s: string) => s.length > 1 && s === s.toUpperCase() && /^[A-ZÁÉÍÓÚÜÑÀÂÈÊÎÔÙÛŒÆÇ'''-]+$/.test(s);
  const upperCount = parts.filter(isUpperCase).length;
  if (upperCount >= 1 && parts.length >= 2) {
    let i = 0;
    while (i < parts.length && isUpperCase(parts[i])) i++;
    if (i > 0 && i < parts.length) {
      const lastName = parts.slice(0, i).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
      const firstName = parts.slice(i).join(" ");
      return `${firstName} ${lastName}`;
    }
  }
  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Cache for performance
const teamCache = new Map<string, string>();
const riderCache = new Map<string, string>();
let allRidersCache: { id: string; name: string }[] | null = null;

async function getAllRiders() {
  if (!allRidersCache) {
    allRidersCache = await db.select({ id: schema.riders.id, name: schema.riders.name }).from(schema.riders).limit(20000);
  }
  return allRidersCache;
}

async function findOrCreateTeam(name: string): Promise<string> {
  if (teamCache.has(name)) return teamCache.get(name)!;
  const existing = await db.query.teams.findFirst({ where: ilike(schema.teams.name, name) });
  if (existing) { teamCache.set(name, existing.id); return existing.id; }
  if (DRY_RUN) return "dry-run-team";
  const [created] = await db.insert(schema.teams).values({ name, discipline: "mtb" }).returning({ id: schema.teams.id });
  teamCache.set(name, created.id);
  return created.id;
}

async function findOrCreateRider(rawName: string, teamId: string): Promise<string> {
  const name = normalizeRiderName(rawName);
  const cacheKey = name.toLowerCase();
  if (riderCache.has(cacheKey)) return riderCache.get(cacheKey)!;

  const stripped = stripAccents(name).toLowerCase();
  const all = await getAllRiders();

  // Exact ilike match
  const exactMatch = all.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (exactMatch) {
    if (!DRY_RUN) await db.update(schema.riders).set({ teamId }).where(eq(schema.riders.id, exactMatch.id));
    riderCache.set(cacheKey, exactMatch.id);
    return exactMatch.id;
  }

  // Accent-stripped match
  const accentMatch = all.find(r => stripAccents(r.name).toLowerCase() === stripped);
  if (accentMatch) {
    if (!DRY_RUN) await db.update(schema.riders).set({ teamId }).where(eq(schema.riders.id, accentMatch.id));
    riderCache.set(cacheKey, accentMatch.id);
    return accentMatch.id;
  }

  if (DRY_RUN) return "dry-run-rider";
  const [created] = await db.insert(schema.riders).values({ name, teamId }).returning({ id: schema.riders.id });
  riderCache.set(cacheKey, created.id);
  // Invalidate cache
  allRidersCache = null;
  return created.id;
}

async function ensureRace(eventId: string, categorySlug: string, date: string, uciCategory: string, country: string): Promise<string> {
  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.raceEventId, eventId), eq(schema.races.categorySlug, categorySlug))
  });
  if (existing) return existing.id;

  const isWomen = categorySlug.includes("women") || categorySlug.includes("female");
  const gender = isWomen ? "women" : "men";
  let ageCategory = "elite";
  if (categorySlug.startsWith("junior")) ageCategory = "junior";
  else if (categorySlug.startsWith("u23") || categorySlug.startsWith("sub23")) ageCategory = "u23";
  else if (categorySlug.startsWith("cadet")) ageCategory = "cadet";
  else if (categorySlug.startsWith("master")) ageCategory = "master";

  const eventRow = await db.query.raceEvents.findFirst({ where: eq(schema.raceEvents.id, eventId) });
  const label = categorySlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const raceName = `${eventRow?.name || "Supercup 2026"} - ${label}`;

  if (DRY_RUN) { console.log(`  [DRY] Create race: ${raceName} (${categorySlug})`); return "dry-run-race"; }

  const [created] = await db.insert(schema.races).values({
    name: raceName, categorySlug, date, discipline: "mtb",
    raceType: "one_day", ageCategory, gender, uciCategory,
    country, raceEventId: eventId, status: "completed",
  }).returning({ id: schema.races.id });
  return created.id;
}

interface ImportConfig {
  fileKey: string;
  eventId: string;
  date: string;
  uciCategory: string;
  country: string;
  categories: string[];
}

const IMPORTS: ImportConfig[] = [
  // La Nucia
  { fileKey: "ln_junior", eventId: "0a041321-827c-450b-87c3-e5533ffc8a89", date: "2026-02-08", uciCategory: "C1", country: "ESP", categories: ["junior-men"] },
  { fileKey: "ln_elite", eventId: "0a041321-827c-450b-87c3-e5533ffc8a89", date: "2026-02-08", uciCategory: "C1", country: "ESP", categories: ["elite-men", "u23-men"] },
  { fileKey: "ln_women", eventId: "0a041321-827c-450b-87c3-e5533ffc8a89", date: "2026-02-08", uciCategory: "C1", country: "ESP", categories: ["junior-women", "u23-women", "elite-women"] },
  // Banyoles
  { fileKey: "bn_junior_series", eventId: "0fc55ca5-3693-4ac7-8a26-da68a5fd1433", date: "2026-02-22", uciCategory: "CS", country: "ESP", categories: ["junior-men"] },
  { fileKey: "bn_sub23", eventId: "0fc55ca5-3693-4ac7-8a26-da68a5fd1433", date: "2026-02-22", uciCategory: "CS", country: "ESP", categories: ["u23-men"] },
  { fileKey: "bn_elite", eventId: "0fc55ca5-3693-4ac7-8a26-da68a5fd1433", date: "2026-02-22", uciCategory: "CS", country: "ESP", categories: ["elite-men"] },
  { fileKey: "bn_women", eventId: "0fc55ca5-3693-4ac7-8a26-da68a5fd1433", date: "2026-02-22", uciCategory: "CS", country: "ESP", categories: ["junior-women", "u23-women", "elite-women"] },
];

async function main() {
  console.log(`\n🚴 Supercup 2026 Import [${DRY_RUN ? "DRY RUN" : "LIVE"}]\n`);

  const data = JSON.parse(fs.readFileSync("/tmp/supercup_results_v2.json", "utf-8"));
  let totalInserted = 0, totalSkipped = 0, totalErrors = 0;

  for (const cfg of IMPORTS) {
    const fileSections = data[cfg.fileKey] || {};

    for (const categorySlug of cfg.categories) {
      const results: { pos: number; name: string; team: string }[] = fileSections[categorySlug] || [];
      if (results.length === 0) {
        console.log(`⚠️  ${cfg.fileKey}/${categorySlug}: no results`);
        continue;
      }

      const raceId = await ensureRace(cfg.eventId, categorySlug, cfg.date, cfg.uciCategory, cfg.country);
      console.log(`\n📍 ${cfg.fileKey}/${categorySlug}: ${results.length} results → race ${raceId.slice(0, 8)}`);

      let inserted = 0, skipped = 0, errors = 0;

      for (const r of results) {
        try {
          const teamId = r.team ? await findOrCreateTeam(r.team) : undefined;
          const riderId = await findOrCreateRider(r.name, teamId || "");

          if (!DRY_RUN) {
            const existing = await db.query.raceResults.findFirst({
              where: and(eq(schema.raceResults.raceId, raceId), eq(schema.raceResults.riderId, riderId))
            });
            if (existing) { skipped++; continue; }

            await db.insert(schema.raceResults).values({
              raceId, riderId, position: r.pos, teamId: teamId || null,
            }).onConflictDoNothing();
          }
          inserted++;
        } catch (err: any) {
          errors++;
          if (errors <= 3) console.error(`  Error ${r.name}: ${err.message?.slice(0, 80)}`);
        }
      }

      console.log(`  ✅ ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
      totalInserted += inserted; totalSkipped += skipped; totalErrors += errors;
    }
  }

  console.log(`\n📊 Total: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
