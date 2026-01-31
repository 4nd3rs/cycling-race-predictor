"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface PredictionCardProps {
  position: number;
  riderName: string;
  teamName?: string;
  nationality?: string;
  winProbability: number;
  podiumProbability: number;
  top10Probability: number;
  reasoning?: string;
  formTrend?: "improving" | "stable" | "declining";
  rumourScore?: number;
  className?: string;
}

export function PredictionCard({
  position,
  riderName,
  teamName,
  nationality,
  winProbability,
  podiumProbability,
  top10Probability,
  reasoning,
  formTrend,
  rumourScore,
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
    return "bg-gray-100 text-gray-600";
  };

  const getProbColor = (prob: number) => {
    if (prob >= 0.15) return "bg-green-500";
    if (prob >= 0.05) return "bg-blue-500";
    if (prob >= 0.01) return "bg-gray-400";
    return "bg-gray-200";
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold",
              getPositionStyle(position)
            )}
          >
            {position}
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{riderName}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              {nationality && (
                <span className="text-sm text-muted-foreground">
                  {nationality}
                </span>
              )}
              {teamName && (
                <span className="text-sm text-muted-foreground truncate">
                  {teamName}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {formTrend === "improving" && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                ↑ Form
              </Badge>
            )}
            {formTrend === "declining" && (
              <Badge variant="outline" className="text-red-600 border-red-600">
                ↓ Form
              </Badge>
            )}
            {rumourScore !== undefined && Math.abs(rumourScore) > 0.2 && (
              <Badge
                variant="outline"
                className={cn(
                  rumourScore > 0
                    ? "text-emerald-600 border-emerald-600"
                    : "text-orange-600 border-orange-600"
                )}
              >
                {rumourScore > 0 ? "🔥" : "⚠️"} Intel
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">Win</div>
            <div className="text-lg font-bold">{formatProb(winProbability)}</div>
            <Progress
              value={winProbability * 100}
              className={cn("h-1.5", getProbColor(winProbability))}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">
              Podium
            </div>
            <div className="text-lg font-bold">
              {formatProb(podiumProbability)}
            </div>
            <Progress
              value={podiumProbability * 100}
              className={cn("h-1.5", getProbColor(podiumProbability))}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">
              Top 10
            </div>
            <div className="text-lg font-bold">
              {formatProb(top10Probability)}
            </div>
            <Progress
              value={top10Probability * 100}
              className={cn("h-1.5", getProbColor(top10Probability))}
            />
          </div>
        </div>
        {reasoning && (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            {reasoning}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface PredictionListProps {
  predictions: Array<{
    riderId: string;
    riderName: string;
    teamName?: string;
    nationality?: string;
    predictedPosition: number;
    winProbability: number;
    podiumProbability: number;
    top10Probability: number;
    reasoning?: string;
    formTrend?: "improving" | "stable" | "declining";
    rumourScore?: number;
  }>;
  maxItems?: number;
}

export function PredictionList({
  predictions,
  maxItems = 10,
}: PredictionListProps) {
  const displayPredictions = predictions.slice(0, maxItems);

  return (
    <div className="space-y-4">
      {displayPredictions.map((pred) => (
        <PredictionCard
          key={pred.riderId}
          position={pred.predictedPosition}
          riderName={pred.riderName}
          teamName={pred.teamName}
          nationality={pred.nationality}
          winProbability={pred.winProbability}
          podiumProbability={pred.podiumProbability}
          top10Probability={pred.top10Probability}
          reasoning={pred.reasoning}
          formTrend={pred.formTrend}
          rumourScore={pred.rumourScore}
        />
      ))}
    </div>
  );
}
