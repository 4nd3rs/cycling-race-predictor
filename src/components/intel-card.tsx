import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

interface IntelCardProps {
  riderId: string;
  riderName: string;
  photoUrl?: string | null;
  summary: string | null;
  aggregateScore: string | null;
  tipCount: number | null;
  lastUpdated: Date;
}

function getIntelType(score: number): { label: string; cls: string } {
  if (score < -0.3) return { label: "INJURY", cls: "text-red-400 bg-red-500/15 border-red-500/30" };
  if (score > 0.3) return { label: "FORM", cls: "text-green-400 bg-green-500/15 border-green-500/30" };
  if (score > 0) return { label: "TRANSFER", cls: "text-blue-400 bg-blue-500/15 border-blue-500/30" };
  return { label: "INTEL", cls: "text-muted-foreground bg-muted/40 border-border/40" };
}

export function IntelCard({ riderId, riderName, photoUrl, summary, aggregateScore, tipCount, lastUpdated }: IntelCardProps) {
  const score = parseFloat(aggregateScore || "0");
  const { label, cls } = getIntelType(score);
  const initials = riderName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Link href={`/riders/${riderId}`} className="block w-full py-3 px-3 hover:bg-muted/20 transition-colors group border-b border-border/20 last:border-0">
      {/* Top row: photo + name + badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className="shrink-0">
          {photoUrl ? (
            <img src={photoUrl} alt={riderName} className="w-8 h-8 rounded-full object-cover object-top border border-border/30" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">{initials}</div>
          )}
        </div>
        <span className="font-semibold text-sm group-hover:text-primary transition-colors truncate min-w-0 flex-1">{riderName}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${cls}`}>{label}</span>
      </div>
      {/* Summary — block element, wraps naturally */}
      {summary && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-10" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {summary}
        </p>
      )}
      {/* Footer */}
      <div className="flex items-center gap-3 mt-1.5 pl-10 text-[11px] text-muted-foreground/70">
        <span>{formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
        {tipCount && tipCount > 0 && <span>{tipCount} {tipCount === 1 ? "source" : "sources"}</span>}
        <span className="ml-auto text-primary/60 group-hover:text-primary transition-colors">View →</span>
      </div>
    </Link>
  );
}
