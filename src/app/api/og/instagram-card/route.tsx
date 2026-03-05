import React from "react";
/**
 * /api/og/instagram-card
 * Generates a Pro Cycling Predictor Instagram story card via @vercel/og.
 *
 * GET /api/og/instagram-card?event=strade-bianche&type=preview&gender=men
 * GET /api/og/instagram-card?event=strade-bianche&type=results&gender=men
 */

import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const W = 1080;
const H = 1920;
const RED = "#C8102E";
const BLACK = "#16171B";
const WHITE = "#F2EDE6";
const MUTED = "#888890";
const DIMMED = "#2A2B30";
const CARD_BG = "#1E1F24";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  const dateOnly = String(d).includes("T") ? String(d).split("T")[0] : String(d);
  return new Date(dateOnly + "T12:00:00Z")
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const css = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
  const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!match) throw new Error(`Could not parse font URL for ${family} ${weight}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

async function resolvePhoto(photoUrl: string | null, name: string): Promise<string | null> {
  if (photoUrl) return photoUrl;
  try {
    const slug = name.trim().replace(/ /g, "_");
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.thumbnail?.source ?? data?.originalimage?.source ?? null;
  } catch { return null; }
}

async function fetchFlag(iso3: string): Promise<string | null> {
  if (!iso3) return null;
  const iso2map: Record<string, string> = {
    BEL:"be",FRA:"fr",ITA:"it",ESP:"es",NED:"nl",GER:"de",GBR:"gb",SUI:"ch",DEN:"dk",NOR:"no",SWE:"se",
    USA:"us",AUS:"au",COL:"co",SLO:"si",POL:"pl",POR:"pt",AUT:"at",IRL:"ie",CAN:"ca",
    NL:"nl",DE:"de",FR:"fr",IT:"it",ES:"es",BE:"be",GB:"gb",CH:"ch",NO:"no",SE:"se",DK:"dk",
  };
  const code = iso2map[iso3.toUpperCase()] ?? iso3.toLowerCase().slice(0, 2);
  try {
    const res = await fetch(`https://flagcdn.com/w40/${code}.png`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return null; }
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchCardData(eventSlug: string, cardType: string, gender: string) {
  const sql = neon(process.env.DATABASE_URL!);

  const events = await sql`SELECT id, name, date, country, discipline, slug FROM race_events WHERE slug = ${eventSlug} LIMIT 1`;
  const event = events[0];
  if (!event) throw new Error(`Event not found: ${eventSlug}`);

  const races = await sql`
    SELECT id, name, date, uci_category, gender FROM races
    WHERE race_event_id = ${event.id} AND status IN ('active','completed')
      AND gender = ${gender} AND age_category = 'elite'
    ORDER BY date ASC LIMIT 1
  `;
  const race = races[0] ?? (await sql`SELECT id, name, date, uci_category FROM races WHERE race_event_id = ${event.id} ORDER BY date ASC LIMIT 1`)[0];

  if (cardType === "preview") {
    const preds = race ? await sql`
      SELECT p.win_probability, r.name AS rider_name, r.nationality, r.photo_url
      FROM predictions p JOIN riders r ON r.id = p.rider_id
      WHERE p.race_id = ${race.id} AND p.win_probability IS NOT NULL
      ORDER BY p.win_probability DESC LIMIT 20
    ` : [];
    const seen = new Set<string>();
    const deduped = preds.filter((p: any) => {
      const key = (p.rider_name ?? "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
    return { event, race, preds: deduped, results: [] };
  } else {
    const results = race ? await sql`
      SELECT rr.position, r.name AS rider_name, r.nationality, r.photo_url
      FROM race_results rr JOIN riders r ON r.id = rr.rider_id
      WHERE rr.race_id = ${race.id} ORDER BY rr.position ASC LIMIT 5
    ` : [];
    return { event, race, preds: [], results };
  }
}

// ── JSX Components ────────────────────────────────────────────────────────────

function BibIcon({ size = 56 }: { size?: number }) {
  const s = size / 200;
  return (
    <div style={{ width: size, height: size, background: BLACK, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: Math.round(22*s), top: Math.round(14*s), width: Math.round(156*s), height: Math.round(172*s), background: WHITE, borderRadius: Math.round(7*s), display: "flex" }} />
      {[{l:33,t:25},{l:152,t:25},{l:33,t:161},{l:152,t:161}].map((p,i)=>(
        <div key={i} style={{ position:"absolute", left:Math.round(p.l*s), top:Math.round(p.t*s), width:Math.round(11*s), height:Math.round(11*s), borderRadius:"50%", background:BLACK, display:"flex" }} />
      ))}
      <span style={{ fontSize:Math.round(122*s), fontWeight:800, color:RED, fontFamily:"Barlow Condensed", lineHeight:1, letterSpacing:"-0.03em", position:"relative" }}>13</span>
    </div>
  );
}

function RiderAvatar({ photo, name, size = 72, glow = false }: { photo: string | null; name: string; size?: number; glow?: boolean }) {
  const borderWidth = glow ? Math.round(size * 0.04) : 0;
  const inner = size - borderWidth * 2;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: glow ? `${borderWidth}px solid ${RED}` : "none", background: DIMMED }}>
      {photo
        ? <img src={photo} style={{ width: inner, height: inner, objectFit: "cover" }} alt={name} />
        : <span style={{ fontSize: Math.round(size * 0.32), fontWeight: 800, color: WHITE, fontFamily: "Barlow Condensed" }}>{initials(name)}</span>
      }
    </div>
  );
}

function FlagImg({ dataUri, size = 24 }: { dataUri: string | null; size?: number }) {
  if (!dataUri) return <div style={{ width: size, height: Math.round(size * 0.67), display: "flex" }} />;
  return <img src={dataUri} style={{ width: size, height: Math.round(size * 0.67), objectFit: "cover", borderRadius: 2 }} alt="" />;
}

function PreviewCard({ event, race, preds }: any) {
  const nameLen = String(event.name).length;
  const nameFontSize = nameLen > 35 ? 96 : nameLen > 24 ? 114 : 136;
  const top = preds[0];
  const rest = preds.slice(1);
  const topPct = top ? Math.round(Number(top.win_probability) * 100) : 0;
  const metaParts = [event.country, (event.discipline ?? "").toUpperCase()].filter(Boolean).join("  ·  ");

  return (
    <div style={{ width: W, height: H, background: BLACK, display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", overflow: "hidden" }}>
      {/* Red corner */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 460, height: 460, background: RED, borderRadius: "0 0 100% 0", display: "flex" }} />
      {/* Right border */}
      <div style={{ position: "absolute", top: 0, right: 0, width: 6, height: H, background: `${RED}44`, display: "flex" }} />

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", padding: "52px 80px 0 52px", flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: WHITE, letterSpacing: "0.2em", fontFamily: "Inter", marginBottom: 4 }}>RACE PREVIEW</span>
        <span style={{ fontSize: nameFontSize, fontWeight: 800, color: WHITE, textTransform: "uppercase", lineHeight: 1.0, letterSpacing: "-0.02em", marginBottom: 8 }}>{String(event.name).toUpperCase()}</span>
        <span style={{ fontSize: 24, fontWeight: 600, color: `${WHITE}AA`, letterSpacing: "0.08em", fontFamily: "Inter" }}>{metaParts}</span>
        <span style={{ fontSize: 24, fontWeight: 600, color: `${WHITE}AA`, fontFamily: "Inter" }}>{race?.date ? fmtDate(race.date) : ""}</span>
      </div>

      {/* Hero */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0 28px" }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: "0.25em", fontFamily: "Inter", marginBottom: 28 }}>FAVOURITE TO WIN</span>
        <RiderAvatar photo={top?._photo ?? null} name={top?.rider_name ?? ""} size={420} glow={true} />
        <span style={{ fontSize: 100, fontWeight: 800, color: WHITE, lineHeight: 0.95, marginTop: 20, textAlign: "center", letterSpacing: "-0.03em", padding: "0 32px", textTransform: "uppercase" }}>{top?.rider_name ?? ""}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 20 }}>
          <FlagImg dataUri={top?._flag} size={36} />
          <span style={{ fontSize: 110, fontWeight: 800, color: RED, lineHeight: 1, letterSpacing: "-0.03em" }}>{topPct}%</span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 52px", marginBottom: 14, flexShrink: 0 }}>
        <div style={{ flex: 1, height: 1, background: DIMMED, display: "flex" }} />
        <span style={{ fontSize: 28, fontWeight: 700, color: WHITE, letterSpacing: "0.2em", fontFamily: "Inter" }}>ALSO WATCH</span>
        <div style={{ flex: 1, height: 1, background: DIMMED, display: "flex" }} />
      </div>

      {/* Rest */}
      <div style={{ display: "flex", flexDirection: "column", padding: "0 52px", gap: 14, flexShrink: 0 }}>
        {rest.map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, background: CARD_BG, borderRadius: 12, padding: "20px 20px", border: `1px solid ${DIMMED}` }}>
            <span style={{ fontSize: 46, fontWeight: 800, color: MUTED, width: 50, flexShrink: 0, fontFamily: "Inter", lineHeight: 1 }}>{i + 2}</span>
            <RiderAvatar photo={p._photo ?? null} name={p.rider_name} size={50} />
            <FlagImg dataUri={p._flag} size={20} />
            <span style={{ fontSize: 62, fontWeight: 800, color: WHITE, flex: 1, lineHeight: 1 }}>{p.rider_name}</span>
            <span style={{ fontSize: 50, fontWeight: 800, color: RED, lineHeight: 1 }}>{Math.round(Number(p.win_probability) * 100)}%</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "24px 52px 64px", flexShrink: 0, marginTop: "auto" }}>
        <BibIcon size={80} />
        <span style={{ fontSize: 26, fontWeight: 800, color: RED, letterSpacing: "0.12em", fontFamily: "Inter" }}>PRO CYCLING PREDICTOR</span>
        <span style={{ fontSize: 22, fontWeight: 400, color: `${WHITE}88`, fontFamily: "Inter" }}>procyclingpredictor.com</span>
      </div>
    </div>
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const eventSlug = searchParams.get("event") ?? "strade-bianche";
  const cardType = searchParams.get("type") ?? "preview";
  const gender = searchParams.get("gender") ?? "men";

  const [barlowBold, barlowSemibold, interRegular] = await Promise.all([
    loadGoogleFont("Barlow Condensed", 800),
    loadGoogleFont("Barlow Condensed", 700),
    loadGoogleFont("Inter", 400),
  ]);

  const { event, race, preds, results } = await fetchCardData(eventSlug, cardType, gender);

  const rows = cardType === "preview" ? preds : results;
  const [photos, flags] = await Promise.all([
    Promise.all(rows.map((r: any) => resolvePhoto(r.photo_url ?? null, r.rider_name ?? ""))),
    Promise.all(rows.map((r: any) => fetchFlag(r.nationality ?? ""))),
  ]);
  rows.forEach((r: any, i: number) => { r._photo = photos[i]; r._flag = flags[i]; });

  const card = PreviewCard({ event, race, preds: rows });

  return new ImageResponse(card, {
    width: W,
    height: H,
    fonts: [
      { name: "Barlow Condensed", data: barlowBold,     weight: 800, style: "normal" },
      { name: "Barlow Condensed", data: barlowSemibold, weight: 700, style: "normal" },
      { name: "Inter",            data: interRegular,   weight: 400, style: "normal" },
    ],
  });
}
