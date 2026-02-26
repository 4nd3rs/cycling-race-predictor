/**
 * Instagram card generator — 1080×1080 PNG
 * Usage:
 *   tsx scripts/agents/generate-instagram-card.tsx --event <slug> --type preview
 *   tsx scripts/agents/generate-instagram-card.tsx --event <slug> --type results
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import React from "react";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const eventSlug = args[args.indexOf("--event") + 1] ?? null;
const cardType: "preview" | "results" = (args[args.indexOf("--type") + 1] as any) ?? "preview";
const gender: "men" | "women" = (args[args.indexOf("--gender") + 1] as any) ?? "men";
const outPath = args[args.indexOf("--out") + 1] ?? `/tmp/pcp-instagram-${cardType}-${gender}-${Date.now()}.png`;

if (!eventSlug) {
  console.error("Usage: tsx generate-instagram-card.tsx --event <slug> --type preview|results [--gender men|women]");
  process.exit(1);
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
async function loadGoogleFont(family: string, weight: number): Promise<Buffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`,
    { headers: { "User-Agent": "Mozilla/5.0" } }
  ).then((r) => r.text());
  const match = css.match(/src: url\(([^)]+)\) format\('(?:woff2|truetype)'\)/);
  if (!match) throw new Error(`Could not parse font URL for ${family} ${weight}`);
  return Buffer.from(await fetch(match[1]).then((r) => r.arrayBuffer()));
}

// ── Images ────────────────────────────────────────────────────────────────────
async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const str = d instanceof Date ? d.toISOString() : String(d);
  const dateOnly = str.includes("T") ? str.split("T")[0] : str;
  return new Date(dateOnly + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).toUpperCase();
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function fetchData(sql: ReturnType<typeof neon>) {
  const [event] = await sql`
    SELECT id, name, date, country, discipline, slug
    FROM race_events WHERE slug = ${eventSlug} LIMIT 1
  `;
  if (!event) throw new Error(`Event not found: ${eventSlug}`);

  const [mainRace] = await sql`
    SELECT id, name, date, uci_category, gender, age_category
    FROM races
    WHERE race_event_id = ${event.id} AND status = 'active'
      AND gender = ${gender} AND age_category = 'elite'
    ORDER BY date ASC LIMIT 1
  `;

  const race = mainRace ?? (await sql`
    SELECT id, name, date, uci_category FROM races
    WHERE race_event_id = ${event.id} AND status = 'active'
    ORDER BY date ASC LIMIT 1
  `)[0];

  if (cardType === "preview") {
    const preds = race ? await sql`
      SELECT p.win_probability, r.name AS rider_name, r.nationality, r.photo_url
      FROM predictions p
      JOIN riders r ON r.id = p.rider_id
      WHERE p.race_id = ${race.id} AND p.win_probability IS NOT NULL
      ORDER BY p.win_probability DESC LIMIT 5
    ` : [];
    return { event, race, preds, results: [] };
  } else {
    const results = race ? await sql`
      SELECT rr.position, r.name AS rider_name, r.nationality, r.photo_url
      FROM race_results rr
      JOIN riders r ON r.id = rr.rider_id
      WHERE rr.race_id = ${race.id}
      ORDER BY rr.position ASC LIMIT 5
    ` : [];
    return { event, race, preds: [], results };
  }
}

// ── Card design ───────────────────────────────────────────────────────────────
const W = 1080;
const H = 1080;
const RED = "#C8102E";
const BLACK = "#0D0D0D";
const WHITE = "#F2EDE6";
const MUTED = "#7A7065";
const DIMMED = "#3A3530";
const CARD_BG = "#161412";

function ProbBar({ pct, width = 400 }: { pct: number; width?: number }) {
  const fill = Math.max(4, Math.round((pct / 100) * width));
  return (
    <div style={{ width, height: 4, background: DIMMED, borderRadius: 2, display: "flex" }}>
      <div style={{ width: fill, height: 4, background: RED, borderRadius: 2 }} />
    </div>
  );
}

function BibIcon({ size = 56 }: { size?: number }) {
  const s = size / 200;
  return (
    <div style={{ width: size, height: size, background: BLACK, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: Math.round(22*s), top: Math.round(14*s), width: Math.round(156*s), height: Math.round(172*s), background: WHITE, borderRadius: Math.round(7*s) }} />
      {[{l:33,t:25},{l:152,t:25},{l:33,t:161},{l:152,t:161}].map((p,i)=>(
        <div key={i} style={{ position:"absolute", left:Math.round(p.l*s), top:Math.round(p.t*s), width:Math.round(11*s), height:Math.round(11*s), borderRadius:"50%", background:BLACK }} />
      ))}
      <div style={{ position:"absolute", display:"flex", alignItems:"center", justifyContent:"center", width:Math.round(156*s), height:Math.round(172*s), left:Math.round(22*s), top:Math.round(14*s), transform:"rotate(180deg)" }}>
        <span style={{ fontSize:Math.round(122*s), fontWeight:800, color:RED, fontFamily:"Barlow Condensed", lineHeight:1, letterSpacing:"-0.03em" }}>13</span>
      </div>
    </div>
  );
}

function RiderAvatar({ photoDataUri, name, size = 72 }: { photoDataUri: string | null; name: string; size?: number }) {
  if (photoDataUri) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: `2px solid ${DIMMED}`, display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoDataUri} style={{ width: size, height: size, objectFit: "cover" }} alt={name} />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: DIMMED, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${CARD_BG}` }}>
      <span style={{ fontSize: Math.round(size * 0.3), fontWeight: 700, color: MUTED, fontFamily: "Barlow Condensed" }}>
        {initials(name)}
      </span>
    </div>
  );
}

function PreviewCard({ event, race, preds }: any) {
  const country = event.country ?? "";
  const uci = race?.uci_category ?? "";
  const discipline = (event.discipline ?? "").toUpperCase();
  const metaParts = [country, discipline, uci].filter(Boolean).join("  ·  ");

  return (
    <div style={{ width: W, height: H, background: BLACK, display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", position: "relative", overflow: "hidden" }}>
      {/* Red top border */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: RED }} />
      {/* Red left bar */}
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />

      {/* Content */}
      <div style={{ display: "flex", flexDirection: "column", padding: "72px 72px 0 88px", flex: 1 }}>

        {/* Eyebrow */}
        <span style={{ fontSize: 20, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 24 }}>
          {gender === "women" ? "WOMEN  ·  RACE PREVIEW" : "RACE PREVIEW"}
        </span>

        {/* Race name */}
        <span style={{
          fontSize: event.name.length > 35 ? 88 : event.name.length > 24 ? 104 : 126,
          fontWeight: 800, color: WHITE, textTransform: "uppercase",
          lineHeight: 0.9, letterSpacing: "-0.01em", marginBottom: 48,
        }}>
          {event.name.toUpperCase()}
        </span>

        {/* Meta — red, no emoji */}
        <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: "0.1em", fontFamily: "Inter", marginBottom: 12 }}>
          {metaParts}
        </span>
        <span style={{ fontSize: 22, fontWeight: 400, color: RED, fontFamily: "Inter", marginBottom: 48, opacity: 0.7 }}>
          {race?.date ? fmtDate(race.date) : ""}
        </span>

        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: DIMMED, marginBottom: 48 }} />

        {/* Predictions with photos */}
        {preds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: DIMMED, letterSpacing: "0.14em", fontFamily: "Inter", marginBottom: 32 }}>
              TOP PREDICTIONS
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {preds.map((p: any, i: number) => {
                const pct = Math.round(Number(p.win_probability) * 100);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    {/* Rank */}
                    <span style={{ fontSize: 22, fontWeight: 700, color: DIMMED, width: 28, flexShrink: 0, fontFamily: "Inter" }}>
                      {i + 1}
                    </span>
                    {/* Photo */}
                    <RiderAvatar photoDataUri={p._photoDataUri ?? null} name={p.rider_name} size={68} />
                    {/* Name + bar */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 38, fontWeight: 800, color: i === 0 ? WHITE : "#C8C0B8", letterSpacing: "0.01em", lineHeight: 1 }}>
                          {p.rider_name}
                        </span>
                        <span style={{ fontSize: 34, fontWeight: 800, color: i === 0 ? RED : "#8A3020", lineHeight: 1, marginLeft: 16 }}>
                          {pct}%
                        </span>
                      </div>
                      <ProbBar pct={pct} width={560} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom brand bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 72px 44px 88px", borderTop: `1px solid ${DIMMED}` }}>
        <span style={{ fontSize: 20, fontWeight: 400, color: DIMMED, letterSpacing: "0.06em", fontFamily: "Inter" }}>
          procyclingpredictor.com
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: WHITE, letterSpacing: "0.1em", textTransform: "uppercase" }}>Pro Cycling</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: RED, letterSpacing: "0.02em", textTransform: "uppercase" }}>Predictor</span>
          </div>
          <BibIcon size={60} />
        </div>
      </div>
    </div>
  );
}

function ResultsCard({ event, race, results }: any) {
  const country = event.country ?? "";
  const discipline = (event.discipline ?? "").toUpperCase();

  return (
    <div style={{ width: W, height: H, background: BLACK, display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: RED }} />
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />

      <div style={{ display: "flex", flexDirection: "column", padding: "72px 72px 0 88px", flex: 1 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 24 }}>
          {gender === "women" ? "WOMEN  ·  RESULTS" : "RESULTS"}
        </span>

        <span style={{ fontSize: event.name.length > 35 ? 88 : event.name.length > 24 ? 104 : 126, fontWeight: 800, color: WHITE, textTransform: "uppercase", lineHeight: 0.9, letterSpacing: "-0.01em", marginBottom: 48 }}>
          {event.name.toUpperCase()}
        </span>

        <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: "0.1em", fontFamily: "Inter", marginBottom: 12 }}>
          {[country, discipline].filter(Boolean).join("  ·  ")}
        </span>
        <span style={{ fontSize: 22, fontWeight: 400, color: RED, fontFamily: "Inter", marginBottom: 52, opacity: 0.7 }}>
          {race?.date ? fmtDate(race.date) : ""}
        </span>

        <div style={{ width: "100%", height: 1, background: DIMMED, marginBottom: 48 }} />

        {results.slice(0, 3).map((r: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 36 }}>
            <span style={{ fontSize: 44, fontWeight: 800, color: [RED, MUTED, MUTED][i], width: 48, flexShrink: 0 }}>
              {i + 1}.
            </span>
            <RiderAvatar photoDataUri={r._photoDataUri ?? null} name={r.rider_name} size={80} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: i === 0 ? 58 : 48, fontWeight: 800, color: i === 0 ? WHITE : "#A09888", lineHeight: 1 }}>
                {r.rider_name}
              </span>
              {r.nationality && (
                <span style={{ fontSize: 20, color: MUTED, fontFamily: "Inter", marginTop: 4 }}>{r.nationality}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 72px 44px 88px", borderTop: `1px solid ${DIMMED}` }}>
        <span style={{ fontSize: 20, fontWeight: 400, color: DIMMED, letterSpacing: "0.06em", fontFamily: "Inter" }}>procyclingpredictor.com</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: WHITE, letterSpacing: "0.1em", textTransform: "uppercase" }}>Pro Cycling</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: RED, letterSpacing: "0.02em", textTransform: "uppercase" }}>Predictor</span>
          </div>
          <BibIcon size={60} />
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Generating ${cardType} card for: ${eventSlug} (${gender})`);

  const [barlowBold, barlowSemibold, interRegular] = await Promise.all([
    loadGoogleFont("Barlow Condensed", 800),
    loadGoogleFont("Barlow Condensed", 700),
    loadGoogleFont("Inter", 400),
  ]);

  const sql = neon(process.env.DATABASE_URL!);
  const { event, race, preds, results } = await fetchData(sql);

  // Pre-fetch all rider photos as data URIs in parallel
  const rows = cardType === "preview" ? preds : results;
  console.log(`Fetching photos for ${rows.length} riders...`);
  const photoUris = await Promise.all(
    rows.map((r: any) => r.photo_url ? fetchImageAsDataUri(r.photo_url) : Promise.resolve(null))
  );
  rows.forEach((r: any, i: number) => { r._photoDataUri = photoUris[i]; });

  const card = cardType === "preview"
    ? React.createElement(PreviewCard, { event, race, preds })
    : React.createElement(ResultsCard, { event, race, results });

  const svg = await satori(card, {
    width: W,
    height: H,
    fonts: [
      { name: "Barlow Condensed", data: barlowBold,     weight: 800, style: "normal" },
      { name: "Barlow Condensed", data: barlowSemibold, weight: 700, style: "normal" },
      { name: "Inter",            data: interRegular,   weight: 400, style: "normal" },
    ],
  });

  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  writeFileSync(outPath, png);
  console.log(`Saved: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
