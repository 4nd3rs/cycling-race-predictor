"use client";

import { useState } from "react";

const FREQUENCY_OPTIONS = [
  { value: "all", label: "All updates", desc: "Previews, race day, results" },
  { value: "key-moments", label: "Key moments", desc: "Previews + results" },
  { value: "race-day-only", label: "Results only", desc: "Just the podium" },
  { value: "off", label: "Group only", desc: "No personal DMs" },
] as const;

interface Props {
  initialPhone?: string | null;
  initialFrequency?: string | null;
}

export function WhatsAppGroupWidget({ initialPhone, initialFrequency }: Props) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [frequency, setFrequency] = useState(initialFrequency ?? "key-moments");
  const [freqStatus, setFreqStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/whatsapp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, frequency }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong");
      } else {
        setStatus("success");
        setMessage(data.emailSent
          ? "Invite sent! Check your WhatsApp (look in Message Requests if you don't see it) — we also emailed it to you as backup."
          : "Invite sent via WhatsApp! Look in Message Requests if you don't see it in your main chats.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error, please try again.");
    }
  }

  async function updateFrequency(value: string) {
    setFrequency(value);
    setFreqStatus("saving");
    try {
      await fetch("/api/whatsapp/frequency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: value }),
      });
      setFreqStatus("saved");
      setTimeout(() => setFreqStatus("idle"), 2000);
    } catch {
      setFreqStatus("idle");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
        <p className="text-sm text-green-400 font-medium">{message}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Join the group and you&apos;ll get race predictions, results and breaking news for every WorldTour race.
        </p>
      </div>
    );
  }

  if (initialPhone) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-sm font-medium">WhatsApp registered</span>
          <span className="text-xs text-muted-foreground">{initialPhone}</span>
        </div>

        {/* Frequency selector */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Personal DM notifications:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateFrequency(opt.value)}
                className={"rounded-lg border px-3 py-2 text-left transition-all cursor-pointer " + (
                  frequency === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border/40 bg-card/20 hover:border-border hover:bg-card/40"
                )}
              >
                <span className="text-xs font-medium block">{opt.label}</span>
                <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
          {freqStatus === "saving" && <p className="text-[10px] text-muted-foreground mt-1">Saving...</p>}
          {freqStatus === "saved" && <p className="text-[10px] text-green-400 mt-1">Saved</p>}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+46 70 000 00 00"
            className="flex-1 rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {status === "loading" ? "..." : "Update"}
          </button>
        </form>
        {status === "error" && <p className="text-xs text-red-400">{message}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/20 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">WhatsApp Notifications</p>
        <p className="text-xs text-muted-foreground mt-1">
          Get race predictions, results and breaking news — directly in WhatsApp.
          Enter your number and we&apos;ll send you the group invite + set up personal DMs.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+46 70 000 00 00"
          required
          className="flex-1 rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={status === "loading" || !phone}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {status === "loading" ? "Sending..." : "Connect"}
        </button>
      </form>
      {status === "error" && <p className="text-xs text-red-400">{message}</p>}
    </div>
  );
}
