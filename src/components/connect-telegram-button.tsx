"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ConnectTelegramButton() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/connect", { method: "POST" });
      const data = await res.json();
      setDeepLink(data.deepLink);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (deepLink) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Open this link in Telegram to connect:
        </p>
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline break-all"
        >
          {deepLink}
        </a>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Refresh to check status
          </Button>
        </div>
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
