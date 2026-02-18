"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  const [pageUrl, setPageUrl] = useState("");
  const [urls, setUrls] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const router = useRouter();

  const hasPageUrl = pageUrl.trim().length > 0;
  const hasPdfUrls = urls.trim().length > 0;

  const handleImport = async () => {
    if (!hasPageUrl && !hasPdfUrls) {
      toast.error("Please enter a results page URL or PDF URLs");
      return;
    }

    setIsImporting(true);

    let requestBody: Record<string, unknown>;
    let loadingMessage: string;

    if (hasPageUrl) {
      requestBody = { resultsPageUrl: pageUrl.trim() };
      loadingMessage = "Discovering and importing results...";
    } else {
      const pdfUrls = urls
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      requestBody = { pdfUrls };
      loadingMessage = "Importing results from PDFs...";
    }

    const toastId = toast.loading(loadingMessage);

    try {
      const response = await fetch(`/api/events/${eventId}/import-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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
      setPageUrl("");
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
            Import results for {eventName}. Provide a results page URL to
            auto-discover PDFs, or paste individual PDF URLs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="page-url">Results Page URL</Label>
            <Input
              id="page-url"
              placeholder="https://example.com/downloads/"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              disabled={isImporting || hasPdfUrls}
            />
            <p className="text-xs text-muted-foreground">
              Auto-discovers result PDFs from a downloads page
            </p>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdf-urls">PDF URLs (one per line)</Label>
            <Textarea
              id="pdf-urls"
              placeholder={"https://example.com/results-elite.pdf\nhttps://example.com/results-women.pdf"}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={4}
              disabled={isImporting || hasPageUrl}
            />
          </div>
        </div>
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
