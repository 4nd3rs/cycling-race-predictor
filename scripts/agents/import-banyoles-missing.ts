/**
 * Import Banyoles 2026 missing results:
 *  - U23 Men    → from Sub23 PDF
 *  - Junior Women → from Feminas PDF (F.Junior section)
 *  - U23 Women    → from Feminas PDF (F.Sub23 section)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, riders, raceResults } from "./lib/db";
import { eq, ilike } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as https from "https";
import * as http from "http";

// Race IDs to import into
const RACE_IDS = {
  u23_men: "e9b6040d-d03f-4290-8a19-2f378a0c1140",
  junior_women: "c033c081-5954-461d-8e2c-e5e640017cf7",
  u23_women: "943c537f-da16-4b22-8e61-553f60bc716b",
};

const PDF_URLS = {
  sub23: "https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Sub23.pdf",
  feminas: "https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Feminas.pdf",
};

interface ParsedResult {
  rank: number;
  name: string;
  team: string;
  timeSeconds: number;
}

// ─── PDF fetch ────────────────────────────────────────────────────────────────
function fetchPdf(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    proto.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPdf(res.headers.location!).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Time parser ──────────────────────────────────────────────────────────────
function parseTimeToSeconds(t: string): number {
  // "1h09:44" or "55:19"
  const hMatch = t.match(/^(\d)h(\d{2}):(\d{2})/);   // single-digit hours only
  if (hMatch) return parseInt(hMatch[1]) * 3600 + parseInt(hMatch[2]) * 60 + parseInt(hMatch[3]);
  const mMatch = t.match(/^(\d{2}):(\d{2})/);
  if (mMatch) return parseInt(mMatch[1]) * 60 + parseInt(mMatch[2]);
  return 0;
}

// ─── Name normaliser ──────────────────────────────────────────────────────────
// VolaTiming: "LASTNAME Firstname" (last token = first name)
function normalizeName(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const firstName = parts[parts.length - 1];
  const lastName = parts
    .slice(0, -1)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return `${firstName} ${lastName}`;
}

// ─── Extract the "Clasificación" section (page 1 only) ───────────────────────
// Stop before "Clasificación Vueltas" / lap-detail pages
function extractClassificationSection(text: string): string {
  // The classification section header
  const start = text.indexOf("CltDor.");
  if (start === -1) return text;
  // The lap detail section starts with "Clasificación Vueltas" or "Vuelta 1"
  const lapSection = text.indexOf("Clasificación Vueltas", start);
  const vueltasSection = text.indexOf("Vuelta 1\n", start);
  let end = text.length;
  if (lapSection !== -1) end = Math.min(end, lapSection);
  if (vueltasSection !== -1) end = Math.min(end, vueltasSection);
  return text.substring(start, end);
}

// ─── VolaTiming PDF parser ─────────────────────────────────────────────────────
// Line format (all concatenated): <rank><bib><name><categoryMarker><team><laps><time>[+gap]
//
// Key fixes:
// 1. Use single-digit hour regex (\dh) to avoid matching "<laps>1h..." as "Nh hours"
// 2. Only parse the classification section (not per-lap breakdowns on later pages)
// 3. Assign rank sequentially (rank/bib boundary is ambiguous in raw text)
function parseVolaTimingText(text: string, categoryMarker: string): ParsedResult[] {
  const section = extractClassificationSection(text);
  const results: ParsedResult[] = [];
  const timeRe = /(\dh\d{2}:\d{2}|\d{2}:\d{2})/;

  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const catIdx = line.indexOf(categoryMarker);
    if (catIdx === -1) continue;

    const before = line.substring(0, catIdx);
    const after  = line.substring(catIdx + categoryMarker.length);

    const timeMatch = after.match(timeRe);
    if (!timeMatch) continue;
    const timeSeconds = parseTimeToSeconds(timeMatch[1]);
    if (!timeSeconds) continue;

    // Strip ALL leading digits (rank+bib combined) — name starts at first letter
    const nameMatch = before.match(/^\d+(.+)/u);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].replace(/^\d+/, "").trim();
    if (rawName.length < 2) continue;

    const timePos = after.indexOf(timeMatch[1]);
    const teamStr = after.substring(0, timePos).replace(/\s*\d\s*$/, "").trim();

    results.push({
      rank: results.length + 1,
      name: normalizeName(rawName),
      team: teamStr,
      timeSeconds,
    });
  }

  return results;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function findOrCreateRider(name: string): Promise<string> {
  const exact = await db.select().from(riders).where(ilike(riders.name, name)).limit(1);
  if (exact.length > 0) return exact[0].id;

  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    const partial = await db.select().from(riders)
      .where(ilike(riders.name, `%${last}%`))
      .limit(10);
    for (const r of partial) {
      if (r.name.toLowerCase().includes(first.toLowerCase())) return r.id;
    }
  }

  const id = randomUUID();
  await db.insert(riders).values({ id, name });
  return id;
}

async function importResults(raceId: string, results: ParsedResult[]): Promise<number> {
  const existing = await db.select().from(raceResults).where(eq(raceResults.raceId, raceId)).limit(1);
  if (existing.length > 0) {
    console.log(`  ⚠️  Race ${raceId} already has results — skipping`);
    return 0;
  }

  let count = 0;
  for (const r of results) {
    const riderId = await findOrCreateRider(r.name);
    await db.insert(raceResults).values({
      id: randomUUID(),
      raceId,
      riderId,
      position: r.rank,
      timeSeconds: r.timeSeconds,
    }).onConflictDoNothing();
    count++;
  }

  await db.update(races)
    .set({ status: "completed" } as any)
    .where(eq(races.id, raceId));

  return count;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require("pdf-parse");

  console.log("📥 Fetching PDFs...");
  const [sub23Buf, feminasBuf] = await Promise.all([
    fetchPdf(PDF_URLS.sub23),
    fetchPdf(PDF_URLS.feminas),
  ]);
  console.log(`  Sub23 PDF: ${(sub23Buf.length / 1024).toFixed(0)}KB`);
  console.log(`  Feminas PDF: ${(feminasBuf.length / 1024).toFixed(0)}KB`);

  const [sub23Data, feminasData] = await Promise.all([
    pdfParse(sub23Buf),
    pdfParse(feminasBuf),
  ]);

  // ── 1. U23 Men ───────────────────────────────────────────────────────────
  console.log("\n🔵 Parsing U23 Men (Sub23)...");
  const u23Men = parseVolaTimingText(sub23Data.text, "Sub23");
  console.log(`  Parsed ${u23Men.length} results`);
  u23Men.slice(0, 5).forEach((r) =>
    console.log(`  #${r.rank}: ${r.name} — ${Math.floor(r.timeSeconds/3600)}h${String(Math.floor((r.timeSeconds%3600)/60)).padStart(2,'0')}m${String(r.timeSeconds%60).padStart(2,'0')}s`)
  );

  // ── 2. Junior Women ──────────────────────────────────────────────────────
  console.log("\n🔴 Parsing Junior Women (F.Junior)...");
  const juniorWomen = parseVolaTimingText(feminasData.text, "F.Junior");
  console.log(`  Parsed ${juniorWomen.length} results`);
  juniorWomen.slice(0, 5).forEach((r) =>
    console.log(`  #${r.rank}: ${r.name} — ${Math.floor(r.timeSeconds/60)}m${String(r.timeSeconds%60).padStart(2,'0')}s`)
  );

  // ── 3. U23 Women ─────────────────────────────────────────────────────────
  console.log("\n🟠 Parsing U23 Women (F.Sub23)...");
  const u23Women = parseVolaTimingText(feminasData.text, "F.Sub23");
  console.log(`  Parsed ${u23Women.length} results`);
  u23Women.slice(0, 5).forEach((r) =>
    console.log(`  #${r.rank}: ${r.name} — ${Math.floor(r.timeSeconds/3600)}h${String(Math.floor((r.timeSeconds%3600)/60)).padStart(2,'0')}m${String(r.timeSeconds%60).padStart(2,'0')}s`)
  );

  // ── Sanity check ─────────────────────────────────────────────────────────
  console.log("\n📊 Counts:", u23Men.length, "U23M /", juniorWomen.length, "JunW /", u23Women.length, "U23W");
  if (u23Men.length < 10 || juniorWomen.length < 5 || u23Women.length < 5) {
    console.error("❌ Too few results — aborting import");
    process.exit(1);
  }

  // ── Import ────────────────────────────────────────────────────────────────
  console.log("\n💾 Importing...");
  const n1 = await importResults(RACE_IDS.u23_men,      u23Men);
  console.log(`  ✅ U23 Men: ${n1}`);
  const n2 = await importResults(RACE_IDS.junior_women, juniorWomen);
  console.log(`  ✅ Junior Women: ${n2}`);
  const n3 = await importResults(RACE_IDS.u23_women,    u23Women);
  console.log(`  ✅ U23 Women: ${n3}`);

  console.log(`\n🏁 Done! Total: ${n1 + n2 + n3} results imported`);
}

main().catch(console.error).finally(() => process.exit(0));
