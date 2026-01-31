"use client";

import { cn } from "@/lib/utils";

interface ProbabilityBarProps {
  probability: number; // 0-1
  label?: string;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
  colorScheme?: "default" | "gradient" | "tier";
  className?: string;
}

export function ProbabilityBar({
  probability,
  label,
  showPercentage = true,
  size = "md",
  colorScheme = "default",
  className,
}: ProbabilityBarProps) {
  const percentage = Math.round(probability * 100);

  const getBarColor = (prob: number) => {
    if (colorScheme === "tier") {
      if (prob >= 0.15) return "bg-green-500";
      if (prob >= 0.05) return "bg-blue-500";
      if (prob >= 0.01) return "bg-yellow-500";
      return "bg-gray-300";
    }
    if (colorScheme === "gradient") {
      // Gradient from red (low) to green (high)
      const hue = Math.round(prob * 120); // 0 = red, 120 = green
      return `bg-gradient-to-r from-[hsl(${hue},70%,50%)] to-[hsl(${Math.min(hue + 20, 120)},70%,50%)]`;
    }
    return "bg-primary";
  };

  const sizeClasses = {
    sm: "h-1.5",
    md: "h-2.5",
    lg: "h-4",
  };

  const formatPercentage = (prob: number) => {
    if (prob >= 0.01) {
      return `${(prob * 100).toFixed(1)}%`;
    }
    if (prob > 0) {
      return "<1%";
    }
    return "0%";
  };

  return (
    <div className={cn("space-y-1", className)}>
      {(label || showPercentage) && (
        <div className="flex justify-between text-sm">
          {label && (
            <span className="text-muted-foreground">{label}</span>
          )}
          {showPercentage && (
            <span className="font-medium">{formatPercentage(probability)}</span>
          )}
        </div>
      )}
      <div className={cn("w-full bg-muted rounded-full overflow-hidden", sizeClasses[size])}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            getBarColor(probability)
          )}
          style={{ width: `${Math.max(percentage, 1)}%` }}
        />
      </div>
    </div>
  );
}

interface ProbabilityComparisonProps {
  items: Array<{
    label: string;
    probability: number;
    highlight?: boolean;
  }>;
  showRank?: boolean;
  className?: string;
}

export function ProbabilityComparison({
  items,
  showRank = true,
  className,
}: ProbabilityComparisonProps) {
  // Sort by probability descending
  const sorted = [...items].sort((a, b) => b.probability - a.probability);
  const maxProb = sorted[0]?.probability || 0;

  return (
    <div className={cn("space-y-3", className)}>
      {sorted.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "space-y-1",
            item.highlight && "bg-muted/50 -mx-2 px-2 py-1 rounded"
          )}
        >
          <div className="flex justify-between text-sm">
            <span
              className={cn(
                "truncate",
                item.highlight && "font-medium"
              )}
            >
              {showRank && (
                <span className="text-muted-foreground mr-2">
                  {index + 1}.
                </span>
              )}
              {item.label}
            </span>
            <span className="font-medium ml-2">
              {item.probability >= 0.01
                ? `${(item.probability * 100).toFixed(1)}%`
                : "<1%"}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                item.highlight ? "bg-primary" : "bg-primary/60"
              )}
              style={{
                width: `${maxProb > 0 ? (item.probability / maxProb) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface WinProbabilityDisplayProps {
  probability: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function WinProbabilityDisplay({
  probability,
  size = "md",
  showLabel = true,
  className,
}: WinProbabilityDisplayProps) {
  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  };

  const getTierInfo = (prob: number) => {
    if (prob >= 0.2) return { label: "Race Favorite", color: "text-green-600" };
    if (prob >= 0.1) return { label: "Strong Contender", color: "text-blue-600" };
    if (prob >= 0.05) return { label: "Podium Threat", color: "text-yellow-600" };
    if (prob >= 0.01) return { label: "Outside Chance", color: "text-gray-600" };
    return { label: "Long Shot", color: "text-gray-400" };
  };

  const tier = getTierInfo(probability);

  return (
    <div className={cn("text-center", className)}>
      <div className={cn("font-bold", sizeClasses[size], tier.color)}>
        {probability >= 0.01 ? `${(probability * 100).toFixed(1)}%` : "<1%"}
      </div>
      {showLabel && (
        <div className="text-sm text-muted-foreground mt-1">{tier.label}</div>
      )}
    </div>
  );
}
