import { ImageResponse } from "next/og";
import { db, raceEvents, races, predictions, riders } from "@/lib/db";
import { eq, and, desc, isNotNull, asc } from "drizzle-orm";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Props {
  params: Promise<{ discipline: string; eventSlug: string }>;
}

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const css = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());
  const match = css.match(/src: url\(([^)]+)\) format\('woff2'\)/);
  if (!match) throw new Error("Could not parse font URL");
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

const COUNTRY_FLAG: Record<string, string> = {
  BEL: "🇧🇪", ITA: "🇮🇹", FRA: "🇫🇷", ESP: "🇪🇸", NED: "🇳🇱",
  SUI: "🇨🇭", GBR: "🇬🇧", GER: "🇩🇪", NOR: "🇳🇴", DEN: "🇩🇰",
  AUT: "🇦🇹", POL: "🇵🇱", POR: "🇵🇹", AUS: "🇦🇺", USA: "🇺🇸",
  COL: "🇨🇴", SLO: "🇸🇮", CZE: "🇨🇿",
};

function formatRaceDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

export default async function Image({ params }: Props) {
  const { discipline, eventSlug } = await params;

  // Load font
  const [barlowBold, barlowSemibold, interRegular] = await Promise.all([
    loadGoogleFont("Barlow Condensed", 800).catch(() => null),
    loadGoogleFont("Barlow Condensed", 700).catch(() => null),
    loadGoogleFont("Inter", 400).catch(() => null),
  ]);

  // Fetch race event
  const event = await db.query.raceEvents.findFirst({
    where: eq(raceEvents.slug, eventSlug),
  });

  if (!event) {
    return new ImageResponse(
      <div style={{ background: "#0D0D0D", width: 1200, height: 630, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#C8102E", fontFamily: "sans-serif", fontSize: 48 }}>Race not found</span>
      </div>,
      { width: 1200, height: 630 }
    );
  }

  // Fetch races for this event — prefer elite men, fall back to first
  const allRaces = await db
    .select()
    .from(races)
    .where(and(eq(races.raceEventId, event.id), eq(races.status, "active")))
    .orderBy(asc(races.date));

  const mainRace =
    allRaces.find((r) => r.gender === "men" && r.ageCategory === "elite") ??
    allRaces[0];

  // Fetch top 3 predictions
  type Prediction = { riderName: string; winPct: number };
  let topPredictions: Prediction[] = [];
  if (mainRace) {
    const rows = await db
      .select({ winProbability: predictions.winProbability, name: riders.name })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .where(and(eq(predictions.raceId, mainRace.id), isNotNull(predictions.winProbability)))
      .orderBy(desc(predictions.winProbability))
      .limit(3);

    topPredictions = rows.map((r) => ({
      riderName: r.name ?? "",
      winPct: Math.round(Number(r.winProbability) * 100),
    }));
  }

  const disciplineLabel = discipline === "road" ? "ROAD" : discipline === "mtb" ? "MTB" : discipline.toUpperCase();
  const uciCat = mainRace?.uciCategory ?? "";
  const flag = event.country ? (COUNTRY_FLAG[event.country] ?? "") : "";
  const dateStr = mainRace?.date ? formatRaceDate(mainRace.date) : event.date ? formatRaceDate(event.date) : "";
  const hasPredictions = topPredictions.length > 0;

  const fonts = [];
  if (barlowBold) fonts.push({ name: "Barlow Condensed", data: barlowBold, weight: 800 as const, style: "normal" as const });
  if (barlowSemibold) fonts.push({ name: "Barlow Condensed", data: barlowSemibold, weight: 700 as const, style: "normal" as const });
  if (interRegular) fonts.push({ name: "Inter", data: interRegular, weight: 400 as const, style: "normal" as const });

  return new ImageResponse(
    <div
      style={{
        width: 1200,
        height: 630,
        background: "#0D0D0D",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Barlow Condensed', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Red top border */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "#C8102E" }} />

      {/* Red left accent bar */}
      <div style={{ position: "absolute", left: 0, top: 4, bottom: 0, width: 6, background: "#C8102E" }} />

      {/* Brand mark — top left */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "absolute", top: 32, left: 36 }}>
        {/* Bib SVG */}
        <svg viewBox="0 0 200 200" width="40" height="40">
          <rect width="200" height="200" fill="#0D0D0D" />
          <rect x="22" y="14" width="156" height="172" rx="7" fill="#FFFFFF" />
          <circle cx="38" cy="30" r="5.5" fill="#0D0D0D" />
          <circle cx="162" cy="30" r="5.5" fill="#0D0D0D" />
          <circle cx="38" cy="170" r="5.5" fill="#0D0D0D" />
          <circle cx="162" cy="170" r="5.5" fill="#0D0D0D" />
          <text x="100" y="100" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="800" fontSize="122" fill="#C8102E" textAnchor="middle" dominantBaseline="middle" transform="rotate(180, 100, 100)">13</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#F2EDE6", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Barlow Condensed, sans-serif" }}>
            Pro Cycling
          </span>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#C8102E", letterSpacing: "0.02em", textTransform: "uppercase", fontFamily: "Barlow Condensed, sans-serif" }}>
            Predictor
          </span>
        </div>
      </div>

      {/* Discipline + UCI category badge — top right */}
      <div style={{ position: "absolute", top: 36, right: 48, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#7A7065", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Inter, sans-serif" }}>
          {disciplineLabel}{uciCat ? ` · ${uciCat}` : ""}
        </span>
        {flag && <span style={{ fontSize: 24 }}>{flag}</span>}
      </div>

      {/* Race name — main hero */}
      <div
        style={{
          position: "absolute",
          left: 48,
          top: 110,
          right: 48,
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <span
          style={{
            fontSize: event.name.length > 30 ? 88 : 104,
            fontWeight: 800,
            color: "#F2EDE6",
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
            lineHeight: 0.92,
            fontFamily: "Barlow Condensed, sans-serif",
          }}
        >
          {event.name.toUpperCase()}
        </span>
      </div>

      {/* Bottom section */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 6,
          right: 0,
          height: 140,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          paddingBottom: 36,
          paddingLeft: 42,
          paddingRight: 48,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          gap: 14,
        }}
      >
        {/* Date */}
        <span style={{ fontSize: 18, fontWeight: 400, color: "#7A7065", letterSpacing: "0.05em", fontFamily: "Inter, sans-serif", textTransform: "uppercase" }}>
          {dateStr}
        </span>

        {/* Predictions row */}
        {hasPredictions && (
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#4A443E", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "Inter, sans-serif", marginRight: 4 }}>
              TOP PICKS
            </span>
            {topPredictions.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i > 0 && <span style={{ color: "#2A2520", fontSize: 18 }}>·</span>}
                <span style={{ fontSize: 22, fontWeight: 800, color: "#F2EDE6", fontFamily: "Barlow Condensed, sans-serif", letterSpacing: "0.01em" }}>
                  {p.riderName}
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#C8102E", fontFamily: "Barlow Condensed, sans-serif" }}>
                  {p.winPct}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts,
    }
  );
}
