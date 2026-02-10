"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SyncRankingsButtonProps {
  raceId: string;
}

export function SyncRankingsButton({ raceId }: SyncRankingsButtonProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/races/${raceId}/sync-rankings`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to sync rankings");
      }

      const data = await response.json();
      const cleanedMsg = data.cleaned > 0 ? `, ${data.cleaned} misclassified removed` : "";
      toast.success(
        `UCI rankings synced! ${data.synced} riders matched, ${data.notFound} not found${cleanedMsg}`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync UCI rankings"
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={isSyncing}
    >
      {isSyncing ? "Syncing..." : "🏆 Sync UCI Rankings"}
    </Button>
  );
}
