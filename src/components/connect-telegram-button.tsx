"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Props {
  connected?: boolean;
}

export function ConnectTelegramButton({ connected: initialConnected = false }: Props) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(initialConnected);

  async function handleConnect() {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/connect", { method: "POST" });
      const data = await res.json();
      setDeepLink(data.deepLink);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await fetch("/api/telegram/disconnect", { method: "POST" });
      setConnected(false);
      setDeepLink(null);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  if (connected) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-green-400 flex items-center gap-1.5">
          <span>✓</span> Telegram connected
        </span>
        <button
          onClick={handleDisconnect}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Disconnect"}
        </button>
      </div>
    );
  }

  if (deepLink) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Open this link in Telegram to connect:</p>
        <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">{deepLink}</a>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Refresh to check status
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={handleConnect} disabled={loading} size="sm">
      {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      Connect Telegram for alerts
    </Button>
  );
}
