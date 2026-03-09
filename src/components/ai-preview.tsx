"use client";

import { useState } from "react";
import Link from "next/link";

interface RiderLink {
  name: string;
  id: string;
}

/**
 * Renders AI preview text with:
 * - **bold** names parsed from markdown
 * - Rider names linked to their profile pages
 * - Expand/collapse for long text
 */
export function AiPreviewText({
  text,
  riderLinks,
  clampLines = 8,
}: {
  text: string;
  riderLinks?: RiderLink[];
  clampLines?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/).filter(Boolean);

  // Build a lookup: normalized name → rider link
  const riderMap = new Map<string, RiderLink>();
  for (const r of riderLinks ?? []) {
    riderMap.set(r.name.toLowerCase(), r);
  }

  return (
    <div className="relative">
      <div
        className={expanded ? "" : "overflow-hidden"}
        style={expanded ? undefined : { maxHeight: `${clampLines * 1.45}em` }}
      >
        <div className="space-y-2.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[13px] text-foreground/85 leading-[1.45em]">
              {renderSegments(p, riderMap)}
            </p>
          ))}
        </div>
      </div>
      {/* Fade overlay when collapsed */}
      {!expanded && paragraphs.length > 1 && (
        <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
      >
        {expanded ? "Show less" : "Read more"}
      </button>
    </div>
  );
}

// Parse a paragraph string, handling bold markers and rider names.
function renderSegments(text: string, riderMap: Map<string, RiderLink>) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, i) => {
    // Check for **bold** markers
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      const name = boldMatch[1];
      const rider = findRider(name, riderMap);
      if (rider) {
        return (
          <Link
            key={i}
            href={`/riders/${rider.id}`}
            className="font-semibold text-foreground hover:text-primary transition-colors"
          >
            {name}
          </Link>
        );
      }
      return <strong key={i} className="font-semibold text-foreground">{name}</strong>;
    }

    // For non-bold segments, still try to find and link rider names
    return <span key={i}>{linkRiderNames(part, riderMap)}</span>;
  });
}

/**
 * Within a plain text segment, find rider names and make them bold + linked.
 */
function linkRiderNames(text: string, riderMap: Map<string, RiderLink>) {
  if (riderMap.size === 0) return text;

  // Sort riders by name length (longest first) to match "Van der Poel Mathieu" before "Mathieu"
  const riders = [...riderMap.values()].sort((a, b) => b.name.length - a.name.length);

  // Build a single regex that matches any rider name (case-insensitive)
  const escaped = riders.map(r => escapeRegex(r.name));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");

  const parts = text.split(regex);
  if (parts.length === 1) return text;

  return parts.map((segment, i) => {
    const rider = findRider(segment, riderMap);
    if (rider) {
      return (
        <Link
          key={i}
          href={`/riders/${rider.id}`}
          className="font-semibold text-foreground hover:text-primary transition-colors"
        >
          {segment}
        </Link>
      );
    }
    return segment;
  });
}

function findRider(name: string, riderMap: Map<string, RiderLink>): RiderLink | undefined {
  return riderMap.get(name.toLowerCase());
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
