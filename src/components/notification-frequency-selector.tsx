"use client";

import { useState } from "react";

const OPTIONS = [
  {
    value: "hourly",
    title: "Give me everything",
    subtitle: "Hourly updates",
    description: "Real-time updates — results, startlist changes, pre-race intel. Best for race days.",
  },
  {
    value: "daily",
    title: "Daily digest",
    subtitle: "One update per day",
    description: "Morning briefing with upcoming races, yesterday's results, and key intel.",
  },
  {
    value: "weekly",
    title: "Weekly roundup",
    subtitle: "Every Monday",
    description: "A clean summary of the coming week's races and what to watch.",
  },
];

export function NotificationFrequencySelector({ currentFrequency }: { currentFrequency: string }) {
  const [selected, setSelected] = useState(currentFrequency || "daily");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function select(value: string) {
    setSelected(value);
    setStatus("saving");
    try {
      await fetch("/api/user/notification-frequency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: value }),
      });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-3">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => select(opt.value)}
          className={"w-full text-left rounded-xl border-2 p-4 transition-all cursor-pointer " + (
            selected === opt.value
              ? "border-primary bg-primary/10"
              : "border-border/40 bg-card/20 hover:border-border hover:bg-card/40"
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-sm">{opt.title}</span>
            <span className="text-xs text-muted-foreground">{opt.subtitle}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
        </button>
      ))}
      {status === "saving" && <p className="text-xs text-muted-foreground">Saving…</p>}
      {status === "saved" && <p className="text-xs text-green-400">Saved</p>}
    </div>
  );
}
