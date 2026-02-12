"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SyncSupercupButtonProps {
  raceId: string;
}

export function SyncSupercupButton({ raceId }: SyncSupercupButtonProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/races/${raceId}/sync-supercup`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to sync SuperCup standings");
      }

      const data = await response.json();
      toast.success(
        `SuperCup standings synced! ${data.synced} riders matched, ${data.notFound} not found`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync SuperCup standings"
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
      {isSyncing ? "Syncing..." : "SC Sync SuperCup"}
    </Button>
  );
}
