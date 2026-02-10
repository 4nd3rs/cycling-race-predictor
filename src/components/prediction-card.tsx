"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type SortMode = "predicted" | "elo" | "uci";

function countryToFlag(countryCode?: string | null) {
  if (!countryCode) return null;
  const code = countryCode.toUpperCase();
  if (code.length === 2) {
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  const alpha3ToAlpha2: Record<string, string> = {
    GER: "DE", USA: "US", RSA: "ZA", GBR: "GB", NED: "NL", DEN: "DK",
    SUI: "CH", AUT: "AT", BEL: "BE", FRA: "FR", ITA: "IT", ESP: "ES",
    POR: "PT", NOR: "NO", SWE: "SE", FIN: "FI", POL: "PL", CZE: "CZ",
    AUS: "AU", NZL: "NZ", JPN: "JP", COL: "CO", ECU: "EC", SLO: "SI",
    CRO: "HR", UKR: "UA", KAZ: "KZ", ERI: "ER", ETH: "ET", RWA: "RW",
    IRL: "IE", CAN: "CA", MEX: "MX", BRA: "BR", ARG: "AR", CHI: "CL",
    RSM: "SM", LUX: "LU", EST: "EE", LAT: "LV", LTU: "LT", SVK: "SK",
    HUN: "HU", ROU: "RO", BUL: "BG", SRB: "RS", GRE: "GR", TUR: "TR",
  };
  const alpha2 = alpha3ToAlpha2[code] || code.slice(0, 2);
  return String.fromCodePoint(...[...alpha2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

interface PredictionRowProps {
  riderId: string;
  position: number;
  riderName: string;
  nationality?: string;
  birthDate?: string;
  teamName?: string;
  uciPoints?: number;
  eloScore?: number;
  hasEnoughData?: boolean;
}

function PredictionRow({
  riderId,
  position,
  riderName,
  nationality,
  birthDate,
  teamName,
  uciPoints,
  eloScore,
  hasEnoughData,
}: PredictionRowProps) {
  const getPositionStyle = (pos: number) => {
    if (pos === 1) return "bg-yellow-500 text-yellow-950";
    if (pos === 2) return "bg-gray-300 text-gray-800";
    if (pos === 3) return "bg-amber-600 text-amber-50";
    return "bg-muted text-muted-foreground";
  };

  return (
    <Link
      href={`/riders/${riderId}`}
      className="flex items-center gap-3 py-2 px-3 hover:bg-muted/50 rounded-lg transition-colors"
    >
      {/* Position */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          getPositionStyle(position)
        )}
      >
        {position}
      </div>

      {/* Name, Flag & Team */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate hover:underline">{riderName}</span>
          {nationality && (
            <span className="text-sm flex-shrink-0" title={nationality}>
              {countryToFlag(nationality)}
            </span>
          )}
          {birthDate && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {new Date().getFullYear() - new Date(birthDate).getFullYear()}y
            </span>
          )}
        </div>
        {teamName && (
          <div className="text-xs text-muted-foreground truncate">{teamName}</div>
        )}
      </div>

      {/* UCI Points */}
      <div className="w-14 text-right shrink-0">
        <div className="text-xs text-muted-foreground">UCI</div>
        <div className="font-semibold text-sm">{uciPoints ? uciPoints : "—"}</div>
      </div>

      {/* ELO Score */}
      {hasEnoughData && eloScore !== undefined && eloScore > 0 ? (
        <div className="w-14 text-right shrink-0">
          <div className="text-xs text-muted-foreground">ELO</div>
          <div className="font-semibold text-sm">{Math.round(eloScore)}</div>
        </div>
      ) : (
        <div className="w-14 text-right shrink-0 text-sm text-muted-foreground">
          —
        </div>
      )}
    </Link>
  );
}

interface PredictionListProps {
  predictions: Array<{
    riderId: string;
    riderName: string;
    teamName?: string;
    nationality?: string;
    birthDate?: string;
    predictedPosition: number;
    winProbability: number;
    podiumProbability: number;
    top10Probability: number;
    reasoning?: string;
    uciPoints?: number;
    uciRank?: number | null;
    eloScore?: number;
    hasEnoughData?: boolean;
  }>;
  maxItems?: number;
}

export function PredictionList({
  predictions,
  maxItems,
}: PredictionListProps) {
  const [sortMode, setSortMode] = useState<SortMode>("predicted");

  // Deduplicate by riderId (keep first occurrence)
  const seen = new Set<string>();
  const uniquePredictions = predictions.filter((pred) => {
    if (seen.has(pred.riderId)) return false;
    seen.add(pred.riderId);
    return true;
  });

  // Sort based on selected mode
  const sorted = [...uniquePredictions].sort((a, b) => {
    if (sortMode === "predicted") {
      return a.predictedPosition - b.predictedPosition;
    } else if (sortMode === "elo") {
      const aElo = a.eloScore ?? 0;
      const bElo = b.eloScore ?? 0;
      // Riders with ELO first, then by ELO desc
      if (aElo > 0 !== bElo > 0) return aElo > 0 ? -1 : 1;
      if (aElo !== bElo) return bElo - aElo;
      // Tiebreak: UCI points
      return (b.uciPoints ?? 0) - (a.uciPoints ?? 0);
    } else {
      const aUci = a.uciPoints ?? 0;
      const bUci = b.uciPoints ?? 0;
      // Riders with UCI points first, then by points desc
      if (aUci > 0 !== bUci > 0) return aUci > 0 ? -1 : 1;
      if (aUci !== bUci) return bUci - aUci;
      // Tiebreak: ELO
      return (b.eloScore ?? 0) - (a.eloScore ?? 0);
    }
  });

  // Assign positions after sorting
  const positioned = sorted.map((pred, index) => ({
    ...pred,
    displayPosition: index + 1,
  }));

  const displayPredictions = maxItems ? positioned.slice(0, maxItems) : positioned;

  return (
    <div>
      {/* Sort toggle */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setSortMode("predicted")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            sortMode === "predicted"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Predicted
        </button>
        <button
          onClick={() => setSortMode("elo")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            sortMode === "elo"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          ELO Rating
        </button>
        <button
          onClick={() => setSortMode("uci")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            sortMode === "uci"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          UCI Points
        </button>
      </div>

      <div className="border rounded-lg divide-y">
        {displayPredictions.map((pred, index) => (
          <PredictionRow
            key={`${pred.riderId}-${index}`}
            riderId={pred.riderId}
            position={pred.displayPosition}
            riderName={pred.riderName}
            nationality={pred.nationality}
            birthDate={pred.birthDate}
            teamName={pred.teamName}
            uciPoints={pred.uciPoints}
            eloScore={pred.eloScore}
            hasEnoughData={pred.hasEnoughData}
          />
        ))}
      </div>
    </div>
  );
}

// Keep the old card for potential detail views
interface PredictionCardProps {
  position: number;
  riderName: string;
  teamName?: string;
  nationality?: string;
  winProbability: number;
  podiumProbability: number;
  top10Probability: number;
  reasoning?: string;
  className?: string;
}

export function PredictionCard({
  position,
  riderName,
  nationality,
  winProbability,
  reasoning,
  className,
}: PredictionCardProps) {
  const formatProb = (prob: number) => {
    if (prob >= 0.01) return `${(prob * 100).toFixed(1)}%`;
    return "<1%";
  };

  const getPositionStyle = (pos: number) => {
    if (pos === 1) return "bg-yellow-500 text-yellow-950";
    if (pos === 2) return "bg-gray-300 text-gray-800";
    if (pos === 3) return "bg-amber-600 text-amber-50";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className={cn("p-4 border rounded-lg", className)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            getPositionStyle(position)
          )}
        >
          {position}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{riderName}</div>
          {nationality && (
            <div className="text-xs text-muted-foreground">{nationality}</div>
          )}
        </div>
        <div className="text-right">
          <div className="font-bold">{formatProb(winProbability)}</div>
          <div className="text-xs text-muted-foreground">win</div>
        </div>
      </div>
      {reasoning && (
        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
          {reasoning}
        </p>
      )}
    </div>
  );
}
