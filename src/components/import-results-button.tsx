"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { toast } from "sonner";

interface ImportResultsButtonProps {
  eventId: string;
  eventName: string;
}

export function ImportResultsButton({
  eventId,
  eventName,
}: ImportResultsButtonProps) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const router = useRouter();

  const handleImport = async () => {
    const pdfUrls = urls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (pdfUrls.length === 0) {
      toast.error("Please enter at least one PDF URL");
      return;
    }

    setIsImporting(true);
    const toastId = toast.loading("Importing results from PDFs...");

    try {
      const response = await fetch(`/api/events/${eventId}/import-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrls }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import results");
      }

      const data = await response.json();

      toast.dismiss(toastId);
      toast.success(
        `Imported ${data.totalImported} results across ${data.racesUpdated} categories`
      );
      setOpen(false);
      setUrls("");
      router.refresh();
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(
        error instanceof Error ? error.message : "Failed to import results"
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Import Results
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Results</DialogTitle>
          <DialogDescription>
            Paste Vola Timing PDF URLs (one per line) to import results for{" "}
            {eventName}. Results will be matched to existing race categories.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder={"https://example.com/results-elite.pdf\nhttps://example.com/results-women.pdf\nhttps://example.com/results-junior.pdf"}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={5}
          disabled={isImporting}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
