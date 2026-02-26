"use client";

/**
 * RaceLinks — shows official website, social icons, and streaming options for a race.
 * Used on homepage cards (compact=true) and race detail pages (compact=false).
 */

interface ExternalLinks {
  website?: string;
  twitter?: string;
  instagram?: string;
  facebook?: string;
  youtube?: string;
  liveStream?: Array<{ name: string; url: string; regions?: string; free?: boolean }>;
  tracking?: string;
}

// ─── Icon SVGs ─────────────────────────────────────────────────────────────

function WebIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx={12} cy={12} r={10} />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.213 5.567 5.951-5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function TVIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x={2} y={7} width={20} height={15} rx={2} ry={2} />
      <polyline points="17 2 12 7 7 2" />
    </svg>
  );
}

function TrackingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

// ─── Compact (homepage card) ────────────────────────────────────────────────

export function RaceLinksCompact({ links }: { links: ExternalLinks }) {
  if (!links || Object.keys(links).length === 0) return null;

  const hasStream = links.liveStream && links.liveStream.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {links.website && (
        <a
          href={links.website}
          target="_blank"
          rel="noopener noreferrer"
          title="Official website"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <WebIcon className="h-3.5 w-3.5" />
        </a>
      )}
      {links.twitter && (
        <a
          href={links.twitter}
          target="_blank"
          rel="noopener noreferrer"
          title="X / Twitter"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <XIcon className="h-3.5 w-3.5" />
        </a>
      )}
      {links.instagram && (
        <a
          href={links.instagram}
          target="_blank"
          rel="noopener noreferrer"
          title="Instagram"
          className="text-muted-foreground hover:text-pink-400 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <InstagramIcon className="h-3.5 w-3.5" />
        </a>
      )}
      {hasStream && (
        <a
          href={links.liveStream![0].url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Watch: ${links.liveStream!.map(s => s.name).join(', ')}`}
          className="text-muted-foreground hover:text-red-400 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <TVIcon className="h-3.5 w-3.5" />
        </a>
      )}
      {links.tracking && (
        <a
          href={links.tracking}
          target="_blank"
          rel="noopener noreferrer"
          title="Live tracker"
          className="text-muted-foreground hover:text-green-400 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <TrackingIcon className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

// ─── Full (race detail page / hero) ─────────────────────────────────────────

export function RaceLinksSection({ links }: { links: ExternalLinks }) {
  if (!links || Object.keys(links).length === 0) return null;

  const socials = [
    links.website  && { href: links.website,   label: 'Website',   icon: <WebIcon className="h-4 w-4" /> },
    links.twitter  && { href: links.twitter,   label: 'X',         icon: <XIcon className="h-4 w-4" /> },
    links.instagram && { href: links.instagram, label: 'Instagram', icon: <InstagramIcon className="h-4 w-4" /> },
    links.tracking && { href: links.tracking,  label: 'Live Tracker', icon: <TrackingIcon className="h-4 w-4" /> },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: React.ReactNode }>;

  return (
    <div className="space-y-3">
      {/* Social / official links */}
      {socials.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {socials.map((s) => (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              {s.icon}
              {s.label}
            </a>
          ))}
        </div>
      )}


    </div>
  );
}
