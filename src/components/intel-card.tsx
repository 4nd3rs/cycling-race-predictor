import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";

interface IntelCardProps {
  riderId: string;
  riderName: string;
  summary: string | null;
  aggregateScore: string | null;
  tipCount: number | null;
  lastUpdated: Date;
}

function getIntelType(score: number): { label: string; className: string } {
  if (score < -0.3) return { label: "INJURY", className: "bg-red-500/20 text-red-400 border-red-500/30" };
  if (score > 0.3) return { label: "FORM", className: "bg-green-500/20 text-green-400 border-green-500/30" };
  if (score > 0) return { label: "TRANSFER", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  return { label: "INTEL", className: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
}

export function IntelCard({
  riderId,
  riderName,
  summary,
  aggregateScore,
  tipCount,
  lastUpdated,
}: IntelCardProps) {
  const score = parseFloat(aggregateScore || "0");
  const intelType = getIntelType(score);

  return (
    <Card className="border-border/50 hover:border-border transition-colors overflow-hidden w-full">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5 shrink-0">
            {"\u{1F575}\u{FE0F}"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/riders/${riderId}`}
                className="font-semibold text-sm hover:text-primary transition-colors truncate"
              >
                {riderName}
              </Link>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${intelType.className}`}>
                {intelType.label}
              </Badge>
            </div>
            {summary && (
              <p className="text-sm text-muted-foreground line-clamp-2 break-words overflow-hidden">
                {summary}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
              {tipCount && tipCount > 0 && (
                <span>{tipCount} {tipCount === 1 ? "source" : "sources"}</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
