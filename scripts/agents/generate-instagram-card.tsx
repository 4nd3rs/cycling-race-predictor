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
const outPath = args[args.indexOf("--out") + 1] ?? `/tmp/pcp-instagram-${cardType}-${Date.now()}.png`;

if (!eventSlug) {
  console.error("Usage: tsx generate-instagram-card.tsx --event <slug> --type preview|results");
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
  const buf = await fetch(match[1]).then((r) => r.arrayBuffer());
  return Buffer.from(buf);
}

// ── Data ──────────────────────────────────────────────────────────────────────
const COUNTRY_FLAG: Record<string, string> = {
  BEL: "🇧🇪", ITA: "🇮🇹", FRA: "🇫🇷", ESP: "🇪🇸", NED: "🇳🇱",
  SUI: "🇨🇭", GBR: "🇬🇧", GER: "🇩🇪", NOR: "🇳🇴", DEN: "🇩🇰",
  AUT: "🇦🇹", POL: "🇵🇱", POR: "🇵🇹", AUS: "🇦🇺", USA: "🇺🇸",
  COL: "🇨🇴", SLO: "🇸🇮", CZE: "🇨🇿",
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const str = d instanceof Date ? d.toISOString() : String(d);
  const dateOnly = str.includes("T") ? str.split("T")[0] : str;
  return new Date(dateOnly + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).toUpperCase();
}

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
      AND gender = 'men' AND age_category = 'elite'
    ORDER BY date ASC LIMIT 1
  `;

  const race = mainRace ?? (await sql`
    SELECT id, name, date, uci_category FROM races
    WHERE race_event_id = ${event.id} AND status = 'active'
    ORDER BY date ASC LIMIT 1
  `)[0];

  if (cardType === "preview") {
    const preds = race ? await sql`
      SELECT p.win_probability, p.podium_probability, r.name AS rider_name
      FROM predictions p
      JOIN riders r ON r.id = p.rider_id
      WHERE p.race_id = ${race.id} AND p.win_probability IS NOT NULL
      ORDER BY p.win_probability DESC LIMIT 5
    ` : [];
    return { event, race, preds, results: [] };
  } else {
    const results = race ? await sql`
      SELECT rr.position, r.name AS rider_name, r.nationality
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

function ProbBar({ pct, width = 320 }: { pct: number; width?: number }) {
  const fill = Math.round((pct / 100) * width);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ width, height: 3, background: DIMMED, borderRadius: 2, display: "flex" }}>
        <div style={{ width: fill, height: 3, background: RED, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function BibIcon({ size = 56 }: { size?: number }) {
  // Render as a styled div (satori doesn't support SVG children)
  const scale = size / 200;
  return (
    <div style={{
      width: size, height: size,
      background: BLACK,
      display: "flex", alignItems: "center", justifyContent: "center",
      position: "relative",
      flexShrink: 0,
    }}>
      {/* Bib plate */}
      <div style={{
        position: "absolute",
        left: Math.round(22 * scale), top: Math.round(14 * scale),
        width: Math.round(156 * scale), height: Math.round(172 * scale),
        background: WHITE,
        borderRadius: Math.round(7 * scale),
      }} />
      {/* 4 holes */}
      {[
        { l: Math.round(33 * scale), t: Math.round(25 * scale) },
        { l: Math.round(152 * scale), t: Math.round(25 * scale) },
        { l: Math.round(33 * scale), t: Math.round(161 * scale) },
        { l: Math.round(152 * scale), t: Math.round(161 * scale) },
      ].map((pos, i) => (
        <div key={i} style={{
          position: "absolute",
          left: pos.l, top: pos.t,
          width: Math.round(11 * scale), height: Math.round(11 * scale),
          borderRadius: "50%",
          background: BLACK,
        }} />
      ))}
      {/* "13" — rotated 180° = upside down. Satori doesn't support CSS transform on text,
           so we stack the characters in reverse and flip via writing direction trick */}
      <div style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: Math.round(156 * scale),
        height: Math.round(172 * scale),
        left: Math.round(22 * scale),
        top: Math.round(14 * scale),
        transform: "rotate(180deg)",
      }}>
        <span style={{
          fontSize: Math.round(122 * scale),
          fontWeight: 800,
          color: RED,
          fontFamily: "Barlow Condensed",
          lineHeight: 1,
          letterSpacing: "-0.03em",
        }}>13</span>
      </div>
    </div>
  );
}

function PreviewCard({ event, race, preds }: any) {
  const flag = event.country ? (COUNTRY_FLAG[event.country] ?? "") : "";
  const uci = race?.uci_category ?? "";
  const discipline = (event.discipline ?? "").toUpperCase();

  return (
    <div style={{
      width: W, height: H,
      background: BLACK,
      display: "flex",
      flexDirection: "column",
      fontFamily: "Barlow Condensed",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Top red border */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: RED }} />
      {/* Left red bar */}
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />

      {/* Main content */}
      <div style={{ display: "flex", flexDirection: "column", padding: "80px 72px 0 88px", flex: 1 }}>

        {/* Eyebrow */}
        <span style={{ fontSize: 22, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 32 }}>
          RACE PREVIEW
        </span>

        {/* Race name */}
        <span style={{
          fontSize: event.name.length > 25 ? 116 : 138,
          fontWeight: 800,
          color: WHITE,
          textTransform: "uppercase",
          lineHeight: 0.88,
          letterSpacing: "-0.01em",
          marginBottom: 40,
        }}>
          {event.name.toUpperCase()}
        </span>

        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 64 }}>
          {flag && <span style={{ fontSize: 36 }}>{flag}</span>}
          <span style={{ fontSize: 26, fontWeight: 700, color: MUTED, letterSpacing: "0.08em", fontFamily: "Inter" }}>
            {discipline}{uci ? ` · ${uci}` : ""}
          </span>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: DIMMED }} />
          <span style={{ fontSize: 24, fontWeight: 400, color: MUTED, fontFamily: "Inter" }}>
            {race?.date ? fmtDate(race.date) : ""}
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: DIMMED, marginBottom: 56 }} />

        {/* Predictions */}
        {preds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: DIMMED, letterSpacing: "0.14em", fontFamily: "Inter", marginBottom: 36 }}>
              TOP PREDICTIONS
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {preds.map((p: any, i: number) => {
                const pct = Math.round(Number(p.win_probability) * 100);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: MUTED, width: 32, fontFamily: "Inter" }}>
                      {i + 1}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                        <span style={{ fontSize: 44, fontWeight: 800, color: WHITE, letterSpacing: "0.01em", lineHeight: 1 }}>
                          {p.rider_name}
                        </span>
                        <span style={{ fontSize: 36, fontWeight: 800, color: RED, lineHeight: 1 }}>
                          {pct}%
                        </span>
                      </div>
                      <ProbBar pct={pct} width={500} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom brand bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "32px 72px 48px 88px",
        borderTop: `1px solid ${DIMMED}`,
      }}>
        <span style={{ fontSize: 22, fontWeight: 400, color: DIMMED, letterSpacing: "0.06em", fontFamily: "Inter" }}>
          procyclingpredictor.com
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: WHITE, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Pro Cycling
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, color: RED, letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Predictor
            </span>
          </div>
          <BibIcon size={64} />
        </div>
      </div>
    </div>
  );
}

function ResultsCard({ event, race, results }: any) {
  const flag = event.country ? (COUNTRY_FLAG[event.country] ?? "") : "";
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div style={{
      width: W, height: H,
      background: BLACK,
      display: "flex",
      flexDirection: "column",
      fontFamily: "Barlow Condensed",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: RED }} />
      <div style={{ position: "absolute", left: 0, top: 8, bottom: 0, width: 8, background: RED }} />

      <div style={{ display: "flex", flexDirection: "column", padding: "80px 72px 0 88px", flex: 1 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: RED, letterSpacing: "0.18em", fontFamily: "Inter", marginBottom: 32 }}>
          RESULTS
        </span>

        <span style={{
          fontSize: event.name.length > 25 ? 116 : 138,
          fontWeight: 800,
          color: WHITE,
          textTransform: "uppercase",
          lineHeight: 0.88,
          letterSpacing: "-0.01em",
          marginBottom: 40,
        }}>
          {event.name.toUpperCase()}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 64 }}>
          {flag && <span style={{ fontSize: 36 }}>{flag}</span>}
          <span style={{ fontSize: 24, fontWeight: 400, color: MUTED, fontFamily: "Inter" }}>
            {race?.date ? fmtDate(race.date) : ""}
          </span>
        </div>

        <div style={{ width: "100%", height: 1, background: DIMMED, marginBottom: 56 }} />

        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {results.slice(0, 3).map((r: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 28 }}>
                <span style={{ fontSize: 44 }}>{medals[i] ?? `${r.position}.`}</span>
                <span style={{ fontSize: i === 0 ? 64 : 52, fontWeight: 800, color: i === 0 ? WHITE : MUTED, letterSpacing: "0.01em" }}>
                  {r.rider_name}
                </span>
                {r.nationality && (
                  <span style={{ fontSize: 28 }}>{COUNTRY_FLAG[r.nationality] ?? ""}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "32px 72px 48px 88px",
        borderTop: `1px solid ${DIMMED}`,
      }}>
        <span style={{ fontSize: 22, fontWeight: 400, color: DIMMED, letterSpacing: "0.06em", fontFamily: "Inter" }}>
          procyclingpredictor.com
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: WHITE, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Pro Cycling
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, color: RED, letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Predictor
            </span>
          </div>
          <BibIcon size={64} />
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Generating ${cardType} card for: ${eventSlug}`);

  const [barlowBold, barlowSemibold, interRegular] = await Promise.all([
    loadGoogleFont("Barlow Condensed", 800),
    loadGoogleFont("Barlow Condensed", 700),
    loadGoogleFont("Inter", 400),
  ]);

  const sql = neon(process.env.DATABASE_URL!);
  const { event, race, preds, results } = await fetchData(sql);

  const card = cardType === "preview"
    ? React.createElement(PreviewCard, { event, race, preds })
    : React.createElement(ResultsCard, { event, race, results });

  const svg = await satori(card, {
    width: W,
    height: H,
    fonts: [
      { name: "Barlow Condensed", data: barlowBold,    weight: 800, style: "normal" },
      { name: "Barlow Condensed", data: barlowSemibold, weight: 700, style: "normal" },
      { name: "Inter",            data: interRegular,  weight: 400, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: W } });
  const png = resvg.render().asPng();
  writeFileSync(outPath, png);

  console.log(`Saved: ${outPath}`);
  return outPath;
}

main().catch((e) => { console.error(e); process.exit(1); });
