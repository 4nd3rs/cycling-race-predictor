/**
 * Import Albenga 2026 XCO results from UCLA 1991 Excel files.
 * Files downloaded from https://www.ucla1991.com/
 *
 * ME.xlsx  → Elite Men        (race 296c0ae7)
 * WE.xlsx  → Elite Women (DE) + U23 Women (DU)
 * MJ.xlsx  → Junior Men       (race fded8415)
 * WJ.xlsx  → Junior Women     (race d18377ff)
 * MU.xlsx  → U23 Men          (race c8076954)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ── Race IDs ─────────────────────────────────────────────────────────────────
const RACE_IDS = {
  ME: "296c0ae7-6357-470e-bd94-851214fcd1b8",
  WE: "07fda4e9-95cb-406c-be6a-41dca3f9ad08",
  WU: "a7449452-fcc7-4bf4-8a93-b6e1e9010a96",
  MJ: "fded8415-a5d9-458e-a6a4-985806f729f5",
  WJ: "d18377ff-75ed-4dc8-91e7-d5db58792e1b",
  MU: "c8076954-e23e-4e70-9e3b-5847a63d768e",
};

// ── Excel time → seconds ──────────────────────────────────────────────────────
function excelTimeToSeconds(t: number): number {
  return Math.round(t * 86400);
}

// ── Name normalisation ────────────────────────────────────────────────────────
function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

// ── Row type ──────────────────────────────────────────────────────────────────
interface XLSXRow {
  pos: number;
  uciId: string | null;
  name: string;
  cat: string;
  team: string | null;
  laps: number;
  timeSeconds: number | null;
  gapSeconds: number | null;
  dnf: boolean;
  dns: boolean;
}

function parseSheet(filePath: string): XLSXRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  const results: XLSXRow[] = [];

  for (const row of rows) {
    // Skip header/category label rows
    if (!row[1] || typeof row[1] !== "string" && typeof row[1] !== "number") continue;
    const pos = typeof row[2] === "number" ? row[2] : parseInt(row[2]);
    if (isNaN(pos)) continue;

    const uciIdRaw = row[4];
    const uciId = uciIdRaw ? String(uciIdRaw) : null;
    const name = String(row[6] || "").trim();
    const cat = String(row[7] || "").trim();
    const team = row[8] ? String(row[8]).trim() : null;
    const laps = typeof row[9] === "number" ? row[9] : 0;
    const timeRaw = row[10];
    const gapRaw = row[11];
    const dnf = laps === 0;
    const dns = false;
    const timeSeconds = timeRaw && typeof timeRaw === "number" ? excelTimeToSeconds(timeRaw) : null;
    const gapSeconds = gapRaw && typeof gapRaw === "number" ? excelTimeToSeconds(gapRaw) : null;

    if (!name) continue;
    results.push({ pos, uciId, name, cat, team, laps, timeSeconds, gapSeconds, dnf, dns });
  }

  return results;
}

// ── Rider lookup/create ───────────────────────────────────────────────────────
const riderCache = new Map<string, string>(); // uciId|normName → rider id

async function findOrCreateRider(row: XLSXRow, allRiders: { id: string; name: string }[]): Promise<string> {
  // Try UCI ID first
  if (row.uciId) {
    const cached = riderCache.get(`uci:${row.uciId}`);
    if (cached) return cached;
    const found = await db.select({ id: schema.riders.id }).from(schema.riders)
      .where(eq(schema.riders.uciId, row.uciId)).limit(1);
    if (found[0]) {
      riderCache.set(`uci:${row.uciId}`, found[0].id);
      return found[0].id;
    }
  }

  // Try name match (XLSX name is "LASTNAME FIRSTNAME" — reorder to "Firstname Lastname")
  const parts = row.name.split(" ");
  // Last token is likely first name if it's title-cased, first tokens are last name
  // Try both "Firstname Lastname" and original
  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const firstToken = parts[0];
  const restTokens = parts.slice(1);
  const reordered = [...restTokens, firstToken].map(titleCase).join(" ");
  const originalTitleCase = parts.map(titleCase).join(" ");

  for (const candidate of [reordered, originalTitleCase]) {
    const normCandidate = normName(candidate);
    const match = allRiders.find(r => normName(r.name) === normCandidate);
    if (match) {
      if (row.uciId) riderCache.set(`uci:${row.uciId}`, match.id);
      // Update UCI ID if missing
      if (row.uciId) {
        await db.update(schema.riders).set({ uciId: row.uciId }).where(eq(schema.riders.id, match.id));
      }
      return match.id;
    }
  }

  // Create new rider
  const displayName = reordered;
  console.log(`  ➕ Creating rider: ${displayName} (UCI: ${row.uciId})`);
  const [newRider] = await db.insert(schema.riders).values({
    name: displayName,
    uciId: row.uciId ?? undefined,
  }).returning({ id: schema.riders.id });
  allRiders.push({ id: newRider.id, name: displayName });
  if (row.uciId) riderCache.set(`uci:${row.uciId}`, newRider.id);
  return newRider.id;
}

// ── Import one category ───────────────────────────────────────────────────────
async function importCategory(
  raceId: string,
  rows: XLSXRow[],
  discipline: string,
  ageCategory: string,
  gender: string,
  allRiders: { id: string; name: string }[]
) {
  // Check if already imported
  const existing = await db.select({ id: schema.raceResults.id }).from(schema.raceResults)
    .where(eq(schema.raceResults.raceId, raceId)).limit(1);
  if (existing.length > 0) {
    console.log(`  ⏭  Already imported (${existing.length}+ results)`);
    return;
  }

  let inserted = 0, errors = 0;
  for (const row of rows) {
    try {
      const riderId = await findOrCreateRider(row, allRiders);
      await db.insert(schema.raceResults).values({
        raceId,
        riderId,
        position: row.dnf || row.dns ? null : row.pos,
        timeSeconds: row.timeSeconds,
        dnf: row.dnf,
        dns: row.dns,
        dsq: false,
      }).onConflictDoNothing();

      // Upsert stats — only if rider doesn't already have a higher-category row
      const higherCats = ageCategory === "junior" ? ["u23", "elite"] : ageCategory === "u23" ? ["elite"] : [];
      const hasHigher = higherCats.length > 0
        ? !!(await db.query.riderDisciplineStats.findFirst({
            where: and(
              eq(schema.riderDisciplineStats.riderId, riderId),
              eq(schema.riderDisciplineStats.discipline, discipline as any),
              eq(schema.riderDisciplineStats.gender, gender),
              ...(higherCats.length ? [require("drizzle-orm").inArray(schema.riderDisciplineStats.ageCategory, higherCats)] : []),
            ),
          }))
        : false;
      if (!hasHigher) {
        await db.insert(schema.riderDisciplineStats).values({
          riderId, discipline: discipline as any, ageCategory, gender,
          currentElo: "1500", eloMean: "1500", eloVariance: "350", uciPoints: 0,
        }).onConflictDoNothing();
      }
      inserted++;
    } catch (e: any) {
      console.error(`  ❌ ${row.name}: ${e.message}`);
      errors++;
    }
  }

  // Mark race as completed
  await db.update(schema.races).set({ status: "completed" }).where(eq(schema.races.id, raceId));
  console.log(`  ✅ ${inserted} inserted, ${errors} errors → marked completed`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`🏔️  Albenga 2026 XCO Results Import${dryRun ? " (DRY RUN)" : ""}\n`);

  const allRiders = await db.select({ id: schema.riders.id, name: schema.riders.name }).from(schema.riders);
  console.log(`Loaded ${allRiders.length} riders from DB\n`);

  const categories: Array<{
    label: string; file: string; raceId: string;
    filterCat?: string[]; discipline: string; ageCategory: string; gender: string;
  }> = [
    { label: "Elite Men",    file: "/tmp/albenga_ME.xlsx", raceId: RACE_IDS.ME, discipline: "mtb", ageCategory: "elite",  gender: "men"   },
    { label: "Elite Women",  file: "/tmp/albenga_WE.xlsx", raceId: RACE_IDS.WE, filterCat: ["DE"], discipline: "mtb", ageCategory: "elite",  gender: "women" },
    { label: "U23 Women",    file: "/tmp/albenga_WE.xlsx", raceId: RACE_IDS.WU, filterCat: ["DU"], discipline: "mtb", ageCategory: "u23",    gender: "women" },
    { label: "Junior Men",   file: "/tmp/albenga_MJ.xlsx", raceId: RACE_IDS.MJ, discipline: "mtb", ageCategory: "junior", gender: "men"   },
    { label: "Junior Women", file: "/tmp/albenga_WJ.xlsx", raceId: RACE_IDS.WJ, discipline: "mtb", ageCategory: "junior", gender: "women" },
    { label: "U23 Men",      file: "/tmp/albenga_MU.xlsx", raceId: RACE_IDS.MU, discipline: "mtb", ageCategory: "u23",    gender: "men"   },
  ];

  for (const cat of categories) {
    console.log(`\n── ${cat.label} ──`);
    let rows = parseSheet(cat.file);
    if (cat.filterCat) {
      rows = rows.filter(r => cat.filterCat!.includes(r.cat));
    }
    // Re-number positions after filter
    rows = rows.map((r, i) => ({ ...r, pos: i + 1 }));
    console.log(`  Parsed ${rows.length} finishers`);
    if (rows[0]) console.log(`  1st: ${rows[0].name} (${rows[0].timeSeconds}s)`);
    if (!dryRun) {
      await importCategory(cat.raceId, rows, cat.discipline, cat.ageCategory, cat.gender, allRiders);
    }
  }

  console.log("\n✅ Done");
}

main().catch(console.error);
