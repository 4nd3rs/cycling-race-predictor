/**
 * Dry-run: parse PDFs and print results without writing to DB.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import * as https from "https";
import * as http from "http";

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

function parseTimeToSeconds(t: string): number {
  const hMatch = t.match(/^(\d)h(\d{2}):(\d{2})/);
  if (hMatch) return parseInt(hMatch[1]) * 3600 + parseInt(hMatch[2]) * 60 + parseInt(hMatch[3]);
  const mMatch = t.match(/^(\d{2}):(\d{2})/);
  if (mMatch) return parseInt(mMatch[1]) * 60 + parseInt(mMatch[2]);
  return 0;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,"0")}m${String(sec).padStart(2,"0")}s`;
  return `${m}m${String(sec).padStart(2,"0")}s`;
}

function normalizeName(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const firstName = parts[parts.length - 1];
  const lastName = parts.slice(0, -1)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return `${firstName} ${lastName}`;
}

function extractClassificationSection(text: string): string {
  const start = text.indexOf("CltDor.");
  if (start === -1) return text;
  const lapSection = text.indexOf("Clasificación Vueltas", start);
  const vueltasSection = text.indexOf("Vuelta 1\n", start);
  let end = text.length;
  if (lapSection !== -1) end = Math.min(end, lapSection);
  if (vueltasSection !== -1) end = Math.min(end, vueltasSection);
  return text.substring(start, end);
}

function parseVolaTimingText(text: string, categoryMarker: string) {
  const section = extractClassificationSection(text);
  const results: { rank: number; name: string; team: string; timeSeconds: number }[] = [];
  const timeRe = /(\dh\d{2}:\d{2}|\d{2}:\d{2})/;

  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const catIdx = line.indexOf(categoryMarker);
    if (catIdx === -1) continue;

    const before = line.substring(0, catIdx);
    const after = line.substring(catIdx + categoryMarker.length);

    const timeMatch = after.match(timeRe);
    if (!timeMatch) continue;
    const timeSeconds = parseTimeToSeconds(timeMatch[1]);
    if (!timeSeconds) continue;

    const nameMatch = before.match(/^\d+(.+)/u);
    if (!nameMatch) continue;
    // Strip leading bib digits from name
    const nameRaw = nameMatch[1].replace(/^\d+/, "").trim();
    if (nameRaw.length < 2) continue;

    const timePos = after.indexOf(timeMatch[1]);
    const teamStr = after.substring(0, timePos).replace(/\s*\d\s*$/, "").trim();

    results.push({ rank: results.length + 1, name: normalizeName(nameRaw), team: teamStr, timeSeconds });
  }
  return results;
}

async function main() {
  // Use locally cached PDFs if available
  const pdfParse = require("pdf-parse");
  const fs = require("fs");

  const sub23Buf = fs.existsSync("/tmp/banyoles-sub23.pdf")
    ? fs.readFileSync("/tmp/banyoles-sub23.pdf")
    : await fetchPdf("https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Sub23.pdf");

  const feminasBuf = fs.existsSync("/tmp/banyoles-feminas.pdf")
    ? fs.readFileSync("/tmp/banyoles-feminas.pdf")
    : await fetchPdf("https://supercupmtb.com/wp-content/uploads/2026/02/Clasificacion-SC-CCI-Banyoles-2026-Feminas.pdf");

  const [sub23Data, feminasData] = await Promise.all([
    pdfParse(sub23Buf),
    pdfParse(feminasBuf),
  ]);

  console.log("\n=== U23 Men (Sub23) ===");
  const u23Men = parseVolaTimingText(sub23Data.text, "Sub23");
  console.log(`Total: ${u23Men.length}`);
  u23Men.slice(0, 10).forEach((r) => console.log(`  #${r.rank}: ${r.name} (${formatTime(r.timeSeconds)})`));
  if (u23Men.length > 10) console.log(`  ... and ${u23Men.length - 10} more`);

  console.log("\n=== Junior Women (F.Junior) ===");
  const junW = parseVolaTimingText(feminasData.text, "F.Junior");
  console.log(`Total: ${junW.length}`);
  junW.slice(0, 10).forEach((r) => console.log(`  #${r.rank}: ${r.name} (${formatTime(r.timeSeconds)})`));
  if (junW.length > 10) console.log(`  ... and ${junW.length - 10} more`);

  console.log("\n=== U23 Women (F.Sub23) ===");
  const u23W = parseVolaTimingText(feminasData.text, "F.Sub23");
  console.log(`Total: ${u23W.length}`);
  u23W.slice(0, 10).forEach((r) => console.log(`  #${r.rank}: ${r.name} (${formatTime(r.timeSeconds)})`));
  if (u23W.length > 10) console.log(`  ... and ${u23W.length - 10} more`);
}

main().catch(console.error).finally(() => process.exit(0));
