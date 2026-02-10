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
      toast.success(
        `Startlist updated! ${data.totalRiders} riders total (${data.addedToStartlist} new)`
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
