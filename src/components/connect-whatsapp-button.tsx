"use client";

import { useState } from "react";

interface Props {
  connected: boolean;
  phoneNumber?: string | null;
}

export function ConnectWhatsAppButton({ connected, phoneNumber }: Props) {
  const [step, setStep] = useState<"idle" | "enter-phone" | "enter-code" | "done">(
    connected ? "done" : "idle"
  );
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendCode() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/whatsapp/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    if (res.ok) {
      setStep("enter-code");
    } else {
      const data = await res.json();
      setError(data.error || "Failed to send message");
    }
  }

  async function verifyCode() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/whatsapp/connect", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setLoading(false);
    if (res.ok) {
      setStep("done");
    } else {
      const data = await res.json();
      setError(data.error || "Invalid code");
    }
  }

  async function disconnect() {
    setLoading(true);
    await fetch("/api/whatsapp/connect", { method: "DELETE" });
    setLoading(false);
    setStep("idle");
    setPhone("");
    setCode("");
  }

  if (step === "done") {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-green-500">
          <span>✓</span>
          <span>WhatsApp connected {phoneNumber ? `(${phoneNumber})` : ""}</span>
        </div>
        <button
          onClick={disconnect}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (step === "enter-code") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Enter the 8-character code sent to your WhatsApp:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXXXX"
            maxLength={8}
            className="w-36 px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono tracking-widest"
          />
          <button
            onClick={verifyCode}
            disabled={loading || code.length < 8}
            className="px-4 py-1.5 text-sm font-semibold rounded-md bg-[#25D366] text-white hover:bg-[#1ebe5d] disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
          <button onClick={() => setStep("enter-phone")} className="text-xs text-muted-foreground hover:underline">
            Back
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (step === "enter-phone") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[#25D366]/20 bg-[#25D366]/5 p-3 text-sm">
          <p className="font-medium text-[#25D366] mb-1">First: activate your alerts</p>
          <p className="text-muted-foreground text-xs">Send a WhatsApp message to <span className="font-mono font-semibold text-foreground">+1 681 271 0565</span> (any text). This lets us send you alerts.</p>
          <a href="https://wa.me/16812710565?text=hi" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-[#25D366] hover:underline">
            Open in WhatsApp →
          </a>
        </div>
        <p className="text-sm text-muted-foreground">Then enter your number to receive a verification code:</p>
        <div className="flex gap-2">
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+46701234567"
            className="w-44 px-3 py-1.5 text-sm rounded-md border border-border bg-background"
          />
          <button
            onClick={sendCode}
            disabled={loading || phone.length < 8}
            className="px-4 py-1.5 text-sm font-semibold rounded-md bg-[#25D366] text-white hover:bg-[#1ebe5d] disabled:opacity-50 transition-colors"
          >
            {loading ? "Sending…" : "Send code"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("enter-phone")}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
      Connect WhatsApp
    </button>
  );
}
