"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload } from "lucide-react";

interface UploadStartlistButtonProps {
  eventId: string;
  eventName: string;
}

export function UploadStartlistButton({
  eventId,
  eventName,
}: UploadStartlistButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!selectedFile && !pdfUrl.trim()) {
      toast.error("Please select a PDF file or enter a URL");
      return;
    }

    setIsUploading(true);
    try {
      let response: Response;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        response = await fetch(`/api/events/${eventId}/upload-startlist`, {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch(`/api/events/${eventId}/upload-startlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfUrl: pdfUrl.trim() }),
        });
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload startlist");
      }

      const data = await response.json();

      // Build category summary
      const catSummary = data.categories
        ?.map(
          (c: { category: string; matched: number; total: number }) =>
            `${c.category}: ${c.matched}/${c.total}`
        )
        .join(", ");

      toast.success(
        `Bib numbers updated for ${data.totalMatched} riders! ${catSummary || ""}`,
        { duration: 6000 }
      );

      setOpen(false);
      setSelectedFile(null);
      setPdfUrl("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload startlist"
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Upload Startlist
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Upload Startlist PDF</DialogTitle>
          <DialogDescription>
            Upload a UCI-style startlist PDF to assign bib numbers to riders in{" "}
            {eventName}. Riders are matched by name.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* File upload */}
          <div className="grid gap-2">
            <Label htmlFor="startlist-file">PDF File</Label>
            <div className="flex gap-2">
              <Input
                ref={fileInputRef}
                id="startlist-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] || null);
                  if (e.target.files?.[0]) setPdfUrl("");
                }}
                disabled={isUploading}
              />
            </div>
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedFile.name} (
                {(selectedFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* URL input */}
          <div className="grid gap-2">
            <Label htmlFor="startlist-url">PDF URL</Label>
            <Input
              id="startlist-url"
              type="url"
              placeholder="https://example.com/startlist.pdf"
              value={pdfUrl}
              onChange={(e) => {
                setPdfUrl(e.target.value);
                if (e.target.value) {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }
              }}
              disabled={isUploading}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={isUploading || (!selectedFile && !pdfUrl.trim())}
          >
            {isUploading ? "Processing..." : "Upload & Match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
