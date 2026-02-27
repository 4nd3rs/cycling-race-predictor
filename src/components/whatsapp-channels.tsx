"use client";

const CHANNELS = {
  road_men: {
    label: "Men's Road",
    description: "Predictions, previews & results",
    url: "https://whatsapp.com/channel/0029Vb7oanx9mrGYbDJJNG45",
    disciplines: ["road"] as string[],
    gender: "men",
  },
  road_women: {
    label: "Women's Road",
    description: "Predictions, previews & results",
    url: "https://whatsapp.com/channel/0029VbC2aMEHgZWiUxBIzr2K",
    disciplines: ["road"] as string[],
    gender: "women",
  },
  mtb: {
    label: "MTB",
    description: "XCO & MTB race predictions",
    url: "https://whatsapp.com/channel/0029Vb7WC3GCMY0Ithd8YG2b",
    disciplines: ["mtb", "xco"] as string[],
    gender: null,
  },
} as const;

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

type ChannelVariant = "full" | "road" | "mtb" | "road_men" | "road_women";

interface WhatsAppChannelsProps {
  variant?: ChannelVariant;
  compact?: boolean;
  className?: string;
}

export function WhatsAppChannels({ variant = "full", compact = false, className }: WhatsAppChannelsProps) {
  const allChannels = Object.values(CHANNELS);
  const channels = allChannels.filter((ch) => {
    if (variant === "full") return true;
    if (variant === "road") return ch.disciplines.includes("road");
    if (variant === "mtb") return ch.disciplines.includes("mtb") || ch.disciplines.includes("xco");
    if (variant === "road_men") return ch.gender === "men";
    if (variant === "road_women") return ch.gender === "women";
    return true;
  });

  if (compact) {
    return (
      <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
        {channels.map((ch) => (
          <a
            key={ch.url}
            href={ch.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full border border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 px-3 py-1 transition-colors"
          >
            <WhatsAppIcon className="w-3 h-3 shrink-0" />
            {ch.label}
          </a>
        ))}
      </div>
    );
  }

  const gridCols =
    channels.length === 1
      ? ""
      : channels.length === 2
      ? "sm:grid-cols-2"
      : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`grid gap-3 ${gridCols} ${className ?? ""}`}>
      {channels.map((ch) => (
        <a
          key={ch.url}
          href={ch.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/80 hover:border-[#25D366]/40 transition-all p-4"
        >
          <div className="shrink-0 w-10 h-10 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center group-hover:bg-[#25D366]/20 transition-colors">
            <WhatsAppIcon className="w-5 h-5 text-[#25D366]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{ch.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{ch.description}</p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-[#25D366] opacity-0 group-hover:opacity-100 transition-opacity">
            Follow →
          </span>
        </a>
      ))}
    </div>
  );
}
