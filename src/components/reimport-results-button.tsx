"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ReimportResultsButtonProps {
  raceId: string;
}

const PROGRESS_STAGES = [
  { time: 0, message: "Starting PDF extraction..." },
  { time: 3000, message: "Extracting text from PDF..." },
  { time: 8000, message: "Processing with AI..." },
  { time: 15000, message: "Parsing race categories..." },
  { time: 22000, message: "Saving to database..." },
];

export function ReimportResultsButton({ raceId }: ReimportResultsButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const router = useRouter();
  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!isLoading) return;

    // Show progress toast
    toastIdRef.current = toast.loading("Starting PDF extraction...", {
      duration: Infinity,
    });

    // Update progress stages
    const timeouts: NodeJS.Timeout[] = [];
    PROGRESS_STAGES.forEach(({ time, message }) => {
      if (time > 0) {
        const timeout = setTimeout(() => {
          setStatus(message);
          if (toastIdRef.current) {
            toast.loading(message, { id: toastIdRef.current });
          }
        }, time);
        timeouts.push(timeout);
      }
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [isLoading]);

  const handleReimport = async () => {
    setIsLoading(true);
    setStatus("Starting...");

    try {
      const response = await fetch(`/api/races/${raceId}/reimport-results`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to re-import results");
      }

      const data = await response.json();

      // Dismiss loading toast and show success
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
      toast.success(`Re-imported ${data.imported} results from ${data.categories?.length || 0} categories`);
      router.refresh();
    } catch (error) {
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to re-import results"
      );
    } finally {
      setIsLoading(false);
      setStatus("");
      toastIdRef.current = null;
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleReimport}
      disabled={isLoading}
      title={isLoading ? status : "Re-import results from PDF using AI"}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
      {isLoading ? "Processing..." : "Re-import Results"}
    </Button>
  );
}
