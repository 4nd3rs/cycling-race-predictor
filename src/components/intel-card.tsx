import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

interface IntelCardProps {
  riderId: string;
  riderName: string;
  summary: string | null;
  tipCount: number | null;
  lastUpdated: Date;
}

function parseHeadline(summary: string) {
  let cleaned = summary.replace(/^[^:]+:\s*/, "");
  cleaned = cleaned.replace(/Sentiment is .*?\./gi, "").trim();
  cleaned = cleaned.replace(/Overall outlook is .*?\./gi, "").trim();
  cleaned = cleaned.replace(/Current signals are .*?\./gi, "").trim();

  // Highlight quotes
  const match = cleaned.match(/^'([^']+)'/);
  if (match) {
    const sub = cleaned.replace(match[0], "").replace(/^\s*-\s*/, "").trim();
    return { headline: `"${match[1]}"`, subline: sub };
  }
  
  // Otherwise split by hyphen if possible
  if (cleaned.includes(" - ")) {
    const parts = cleaned.split(" - ");
    return { headline: parts[0].trim(), subline: parts.slice(1).join(" - ").trim() };
  }

  return { headline: cleaned, subline: null };
}

export function IntelCard({ riderId, riderName, summary, tipCount, lastUpdated }: IntelCardProps) {
  if (!summary) return null;
  const { headline, subline } = parseHeadline(summary);

  return (
    <Link href={`/riders/${riderId}`} className="block w-full py-4 pr-4 hover:bg-white/[0.03] transition-colors group relative">
      <div className="flex gap-4">
        <div className="w-1.5 shrink-0 bg-[#3A3530] group-hover:bg-primary transition-colors" />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#C8102E] mb-1.5">
            {riderName}
          </span>
          <h3 className="font-bold text-base sm:text-lg leading-snug tracking-tight text-[#F2EDE6] group-hover:text-primary transition-colors mb-1.5">
            {headline}
          </h3>
          {subline && (
            <p className="text-xs text-[#7A7065] line-clamp-1 italic mb-2">
              {subline}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10px] font-semibold tracking-wider uppercase text-[#4A443E]">
            <span>{formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
            {tipCount && tipCount > 0 && (
              <>
                <span>&bull;</span>
                <span>{tipCount} {tipCount === 1 ? "SOURCE" : "SOURCES"}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
