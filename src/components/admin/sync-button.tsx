"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function SyncButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/admin/sync-uci", {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Sync failed");
      }

      const data = await response.json();
      const r = data.result;
      toast.success(
        `Sync complete: ${r.totalEntries} entries, ${r.ridersCreated} created, ${r.ridersUpdated} updated (${Math.round(r.durationMs / 1000)}s)`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Sync failed"
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button onClick={handleSync} disabled={isSyncing}>
      {isSyncing ? "Syncing... (this may take a few minutes)" : "Sync Now"}
    </Button>
  );
}
