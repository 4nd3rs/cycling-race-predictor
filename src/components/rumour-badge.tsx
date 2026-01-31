"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface RumourBadgeProps {
  score: number; // -1 to 1
  tipCount: number;
  summary?: string;
  className?: string;
}

export function RumourBadge({
  score,
  tipCount,
  summary,
  className,
}: RumourBadgeProps) {
  if (tipCount === 0) {
    return null;
  }

  const getScoreInfo = (score: number) => {
    if (score >= 0.5) {
      return {
        icon: "🔥",
        label: "Strong positive intel",
        bgClass: "bg-green-100 text-green-800 border-green-300",
      };
    }
    if (score >= 0.2) {
      return {
        icon: "👍",
        label: "Positive intel",
        bgClass: "bg-green-50 text-green-700 border-green-200",
      };
    }
    if (score > -0.2) {
      return {
        icon: "💬",
        label: "Mixed intel",
        bgClass: "bg-gray-100 text-gray-700 border-gray-300",
      };
    }
    if (score > -0.5) {
      return {
        icon: "⚠️",
        label: "Negative intel",
        bgClass: "bg-orange-50 text-orange-700 border-orange-200",
      };
    }
    return {
      icon: "🚨",
      label: "Concerning intel",
      bgClass: "bg-red-50 text-red-700 border-red-200",
    };
  };

  const info = getScoreInfo(score);

  const badge = (
    <Badge
      variant="outline"
      className={cn("cursor-help", info.bgClass, className)}
    >
      {info.icon} {tipCount} {tipCount === 1 ? "tip" : "tips"}
    </Badge>
  );

  if (!summary) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{info.label}</p>
          <p className="text-sm text-muted-foreground mt-1">{summary}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface CommunityIntelProps {
  rumours: Array<{
    type: string;
    sentiment: number;
    summary: string;
    sourceCount: number;
    daysAgo: number;
  }>;
  className?: string;
}

export function CommunityIntel({ rumours, className }: CommunityIntelProps) {
  if (rumours.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        No community intel available
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      injury: "🏥",
      form: "📈",
      motivation: "🎯",
      team_dynamics: "🤝",
      equipment: "🔧",
      other: "💬",
    };
    return icons[type] || "💬";
  };

  const getSentimentClass = (sentiment: number) => {
    if (sentiment >= 0.3) return "text-green-600";
    if (sentiment <= -0.3) return "text-red-600";
    return "text-gray-600";
  };

  return (
    <div className={cn("space-y-2", className)}>
      <h4 className="font-medium text-sm">Community Intel</h4>
      <div className="space-y-2">
        {rumours.map((rumour, index) => (
          <div
            key={index}
            className="flex items-start gap-2 text-sm bg-muted/50 rounded-md p-2"
          >
            <span>{getTypeIcon(rumour.type)}</span>
            <div className="flex-1 min-w-0">
              <p className={cn("font-medium", getSentimentClass(rumour.sentiment))}>
                {rumour.summary}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rumour.sourceCount} {rumour.sourceCount === 1 ? "source" : "sources"}
                {" • "}
                {rumour.daysAgo === 0
                  ? "today"
                  : rumour.daysAgo === 1
                    ? "yesterday"
                    : `${rumour.daysAgo}d ago`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
