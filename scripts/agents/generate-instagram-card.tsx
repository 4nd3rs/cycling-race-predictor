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
const isStories = args.includes("--stories");
const outPath = args[args.indexOf("--out") + 1] ?? `/tmp/pcp-instagram-${cardType}-${gender}-${isStories ? "story" : "feed"}-${Date.now()}.png`;

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

async function fetchWikipediaPhoto(name: string): Promise<string | null> {
  try {
    // Try exact name first, then name variants
    const slug = name.trim().replace(/ /g, "_");
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "PCP-CardGenerator/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const photoUrl = data?.thumbnail?.source ?? data?.originalimage?.source ?? null;
    if (!photoUrl) return null;
    return fetchImageAsDataUri(photoUrl);
  } catch {
    return null;
  }
}

async function resolveRiderPhoto(photoUrl: string | null, name: string): Promise<string | null> {
  // 1. Try stored photo_url
  if (photoUrl) {
    const uri = await fetchImageAsDataUri(photoUrl);
    if (uri) return uri;
  }
  // 2. Wikipedia fallback by rider name
  return fetchWikipediaPhoto(name);
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
      ORDER BY p.win_probability DESC LIMIT 20
    ` : [];
    // Deduplicate by rider name, keeping highest probability entry
    const seen = new Set<string>();
    const dedupedPreds = preds.filter((p: any) => {
      if (seen.has(p.rider_name)) return false;
      seen.add(p.rider_name);
      return true;
    }).slice(0, 5);
    return { event, race, preds: dedupedPreds, results: [] };
  } else {
    const results = race ? await sql`
      SELECT rr.position, r.name AS rider_name, r.nationality, r.photo_url
      FROM race_results rr
      JOIN riders r ON r.id = rr.rider_id
      WHERE rr.race_id = ${race.id}
      ORDER BY rr.position ASC LIMIT 10
    ` : [];
    return { event, race, preds: [], results };
  }
}

// ── Card design ───────────────────────────────────────────────────────────────
const W = 1080;
const H = isStories ? 1920 : 1080;
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

function BrandBar() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <span style={{ fontSize: 20, fontWeight: 400, color: WHITE, letterSpacing: "0.06em", fontFamily: "Inter" }}>
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
  );
}

function PreviewCard({ event, race, preds }: any) {
  const country = event.country ?? "";
  const uci = race?.uci_category ?? "";
  const discipline = (event.discipline ?? "").toUpperCase();
  const metaParts = [country, discipline, uci].filter(Boolean).join("  ·  ");
  const nameLen = String(event.name).length;
  const nameFontSizeFeed = nameLen > 30 ? 64 : nameLen > 20 ? 72 : 88;
  const nameFontSizeStory = nameLen > 35 ? 88 : nameLen > 24 ? 104 : 126;

  if (isStories) {
    // ── STORIES (1080×1920) — content centered vertically ──
    const nameFontSize = nameFontSizeStory;
    return (
      <div style={{ width: W, height: H, background: BLACK, display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: RED }} />
        <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: "120px 96px 100px" }}>
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 28, flexShrink: 0 }}>
              {gender === "women" ? "WOMEN  ·  RACE PREVIEW" : "RACE PREVIEW"}
            </span>
            <span style={{ fontSize: nameFontSize, fontWeight: 800, color: WHITE, textTransform: "uppercase", lineHeight: 1.0, letterSpacing: "-0.01em", marginBottom: 64, flexShrink: 0 }}>
              {String(event.name).toUpperCase()}
            </span>
            <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: "0.1em", fontFamily: "Inter", marginBottom: 10, flexShrink: 0 }}>{metaParts}</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: RED, fontFamily: "Inter", marginBottom: 48, flexShrink: 0 }}>{race?.date ? fmtDate(race.date) : ""}</span>
            <div style={{ height: 1, background: DIMMED, marginBottom: 44, flexShrink: 0 }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: WHITE, letterSpacing: "0.14em", fontFamily: "Inter", marginBottom: 32, flexShrink: 0 }}>TOP PREDICTIONS</span>
            {preds.map((p: any, i: number) => {
              const pct = Math.round(Number(p.win_probability) * 100);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 22, flexShrink: 0 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: WHITE, width: 28, flexShrink: 0, fontFamily: "Inter" }}>{i + 1}</span>
                  <RiderAvatar photoDataUri={p._photoDataUri ?? null} name={p.rider_name} size={68} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 49, fontWeight: 800, color: i === 0 ? WHITE : "#C8C0B8", lineHeight: 1 }}>{p.rider_name}</span>
                      <span style={{ fontSize: 34, fontWeight: 800, color: i === 0 ? RED : "#8A3020", lineHeight: 1, marginLeft: 16 }}>{pct}%</span>
                    </div>
                    <ProbBar pct={pct} width={700} />
                  </div>
                </div>
              );
            })}
            <div style={{ height: 1, background: DIMMED, marginTop: 40, marginBottom: 36, flexShrink: 0 }} />
            <BrandBar />
          </div>
        </div>
      </div>
    );
  }

  // ── FEED (1080×1080) — header block + predictions block fills remaining space ──
  const nameFontSize = nameFontSizeFeed;
  return (
    <div style={{ width: 1080, height: 1080, background: BLACK, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Barlow Condensed" }}>
      {/* Top red border */}
      <div style={{ height: 8, background: RED, flexShrink: 0 }} />
      {/* Left red bar — absolute */}
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />
      {/* Header block — fixed height */}
      <div style={{ display: "flex", flexDirection: "column", padding: "44px 88px 0 96px", flexShrink: 0 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 14 }}>
          {gender === "women" ? "WOMEN  ·  RACE PREVIEW" : "RACE PREVIEW"}
        </span>
        <span style={{ fontSize: nameFontSize, fontWeight: 800, color: WHITE, textTransform: "uppercase", lineHeight: 1.0, letterSpacing: "-0.01em", marginBottom: 18 }}>
          {String(event.name).toUpperCase()}
        </span>
        <span style={{ fontSize: 30, fontWeight: 700, color: RED, letterSpacing: "0.1em", fontFamily: "Inter", marginBottom: 6 }}>{metaParts}</span>
        <span style={{ fontSize: 31, fontWeight: 700, color: RED, fontFamily: "Inter", marginBottom: 0 }}>{race?.date ? fmtDate(race.date) : ""}</span>
      </div>
      {/* Predictions block — fills remaining space with even distribution */}
      <div style={{ display: "flex", flexDirection: "column", padding: "0 88px 0 96px", flex: 1, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 1, background: DIMMED, marginBottom: 14 }} />
          <span style={{ fontSize: 25, fontWeight: 700, color: WHITE, letterSpacing: "0.14em", fontFamily: "Inter" }}>TOP PREDICTIONS</span>
        </div>
        {preds.slice(0, 5).map((p: any, i: number) => {
          const pct = Math.round(Number(p.win_probability) * 100);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: WHITE, width: 32, flexShrink: 0, fontFamily: "Inter" }}>{i + 1}</span>
              <RiderAvatar photoDataUri={p._photoDataUri ?? null} name={p.rider_name} size={76} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 49, fontWeight: 800, color: i === 0 ? WHITE : "#C8C0B8", lineHeight: 1 }}>{p.rider_name}</span>
                  <span style={{ fontSize: 42, fontWeight: 800, color: i === 0 ? RED : "#8A3020", lineHeight: 1, marginLeft: 12 }}>{pct}%</span>
                </div>
                <ProbBar pct={pct} width={440} />
              </div>
            </div>
          );
        })}
      </div>
      {/* Brand bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 88px 36px 96px", borderTop: `1px solid ${DIMMED}`, flexShrink: 0 }}>
        <span style={{ fontSize: 18, color: WHITE, fontFamily: "Inter" }}>procyclingpredictor.com</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: WHITE, letterSpacing: "0.1em" }}>PRO CYCLING</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: RED }}>PREDICTOR</span>
          </div>
          <BibIcon size={52} />
        </div>
      </div>
    </div>
  );
}

function ResultsCard({ event, race, results }: any) {
  const country = event.country ?? "";
  const discipline = (event.discipline ?? "").toUpperCase();
  const nameLen = String(event.name).length;
  const nameFontSize = nameLen > 35 ? 72 : nameLen > 24 ? 88 : 104;

  return (
    <div style={{ width: W, height: H, background: BLACK, display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", overflow: "hidden" }}>
      {/* Top red border */}
      <div style={{ height: 8, background: RED, flexShrink: 0 }} />
      {/* Left red bar — absolute */}
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", padding: "44px 88px 0 96px", flexShrink: 0 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 14 }}>
          {gender === "women" ? "WOMEN  ·  RESULTS" : "RESULTS"}
        </span>
        <span style={{ fontSize: nameFontSize, fontWeight: 800, color: WHITE, textTransform: "uppercase", lineHeight: 1.0, letterSpacing: "-0.01em", marginBottom: 18 }}>
          {event.name.toUpperCase()}
        </span>
        <span style={{ fontSize: 30, fontWeight: 700, color: RED, letterSpacing: "0.1em", fontFamily: "Inter", marginBottom: 6 }}>
          {[country, discipline].filter(Boolean).join("  ·  ")}
        </span>
        <span style={{ fontSize: 31, fontWeight: 700, color: RED, fontFamily: "Inter", marginBottom: 0 }}>
          {race?.date ? fmtDate(race.date) : ""}
        </span>
      </div>
      {/* Results block — fills remaining space evenly */}
      <div style={{ display: "flex", flexDirection: "column", padding: "0 88px 0 96px", flex: 1, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 1, background: DIMMED, marginBottom: 14 }} />
          <span style={{ fontSize: 25, fontWeight: 700, color: WHITE, letterSpacing: "0.14em", fontFamily: "Inter" }}>TOP 10</span>
        </div>
        {results.slice(0, 10).map((r: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: i < 3 ? 28 : 22, fontWeight: 800, color: i < 3 ? WHITE : MUTED, width: 32, flexShrink: 0, fontFamily: "Inter" }}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
            </span>
            <RiderAvatar photoDataUri={r._photoDataUri ?? null} name={r.rider_name} size={i < 3 ? 68 : 52} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: i === 0 ? 49 : i < 3 ? 42 : 34, fontWeight: 800, color: i === 0 ? WHITE : i < 3 ? "#C8C0B8" : "#A09888", lineHeight: 1 }}>
                {r.rider_name}
              </span>
              {r.nationality && i < 5 && (
                <span style={{ fontSize: 18, color: MUTED, fontFamily: "Inter", marginTop: 2 }}>{r.nationality}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 96px 52px 96px", borderTop: `1px solid ${DIMMED}` }}>
        <span style={{ fontSize: 20, fontWeight: 400, color: WHITE, letterSpacing: "0.06em", fontFamily: "Inter" }}>procyclingpredictor.com</span>
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
    rows.map((r: any) => resolveRiderPhoto(r.photo_url ?? null, r.rider_name ?? r.name ?? ""))
  );
  rows.forEach((r: any, i: number) => { r._photoDataUri = photoUris[i]; });

  const card = cardType === "preview"
    ? React.createElement(PreviewCard, { event, race, preds })
    : React.createElement(ResultsCard, { event, race, results });

  const svg = await satori(card, {
    width: W,
    height: H, // 1080 feed or 1920 stories
    fonts: [
      { name: "Barlow Condensed", data: barlowBold,     weight: 800, style: "normal" },
      { name: "Barlow Condensed", data: barlowSemibold, weight: 700, style: "normal" },
      { name: "Inter",            data: interRegular,   weight: 400, style: "normal" },
    ],
  });

  const renderWidth = isStories ? W * 2 : W; // feed at 1x (1080), stories at 2x (2160)
  const png = new Resvg(svg, { fitTo: { mode: "width", value: renderWidth } }).render().asPng();
  writeFileSync(outPath, png);
  console.log(`Saved: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
