"use client";

import { useState } from "react";

interface Props {
  initialPhone?: string | null;
}

export function WhatsAppGroupWidget({ initialPhone }: Props) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/whatsapp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong");
      } else {
        setStatus("success");
        setMessage(data.emailSent
          ? "✅ Invite sent! Check your WhatsApp (look in Message Requests if you don't see it) — we also emailed it to you as backup."
          : "✅ Invite sent via WhatsApp! Look in Message Requests if you don't see it in your main chats.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error, please try again.");
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
          <span className="text-green-400 text-sm font-medium">✅ WhatsApp registered</span>
          <span className="text-xs text-muted-foreground">{initialPhone}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          You&apos;ll receive the group invite link on WhatsApp. Already in the group? You&apos;re all set.
        </p>
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
            {status === "loading" ? "…" : "Update"}
          </button>
        </form>
        {status === "error" && <p className="text-xs text-red-400">{message}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/20 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Join the Road Cycling Group</p>
        <p className="text-xs text-muted-foreground mt-1">
          Get predictions, results and breaking news for every WorldTour race — directly in WhatsApp.
          Enter your number and we&apos;ll send you the invite link.
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
          {status === "loading" ? "Sending…" : "Send invite 💬"}
        </button>
      </form>
      {status === "error" && <p className="text-xs text-red-400">{message}</p>}
    </div>
  );
}
