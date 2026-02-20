"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface RefreshStartlistButtonProps {
  raceId: string;
}

export function RefreshStartlistButton({ raceId }: RefreshStartlistButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/races/${raceId}/refresh-startlist`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to refresh startlist");
      }

      const data = await response.json();
      const skipped = data.skippedUnknownCategory ? `, ${data.skippedUnknownCategory} skipped` : "";
      const racesInfo = data.racesUpdated > 1 ? ` across ${data.racesUpdated} races` : "";
      toast.success(
        `Startlist updated! ${data.addedToStartlist} riders added${racesInfo}${skipped}`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to refresh startlist"
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isRefreshing}
    >
      {isRefreshing ? "Refreshing..." : "↻ Refresh Startlist"}
    </Button>
  );
}
