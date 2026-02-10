"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Database, Loader2, CheckCircle } from "lucide-react";

interface ImportResult {
  success: boolean;
  year: number;
  totalRacesFound: number;
  processed: number;
  failed: number;
  eventsCreated: number;
  racesCreated: number;
  resultsCreated: number;
  ridersCreated: number;
  processedRaces: string[];
}

export function ImportHistoricalButton() {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [year, setYear] = useState(2025);
  const [maxRaces, setMaxRaces] = useState(10);

  const handleImport = async () => {
    setImporting(true);
    setResult(null);

    try {
      const response = await fetch("/api/races/import-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          maxRaces,
          raceClasses: ["WC", "HC", "C1"],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import");
      }

      setResult(data);
      toast.success(
        `Imported ${data.resultsCreated} results from ${data.processed} races`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Database className="mr-2 h-4 w-4" />
          Import Historical Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Historical Race Data</DialogTitle>
          <DialogDescription>
            Import XCO race results from XCOdata to populate Elo ratings for
            predictions.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-full mt-1 rounded-md border px-3 py-2"
                disabled={importing}
              >
                <option value={2025}>2025</option>
                <option value={2024}>2024</option>
                <option value={2023}>2023</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Max Races</label>
              <select
                value={maxRaces}
                onChange={(e) => setMaxRaces(parseInt(e.target.value))}
                className="w-full mt-1 rounded-md border px-3 py-2"
                disabled={importing}
              >
                <option value={5}>5 races (quick test)</option>
                <option value={10}>10 races</option>
                <option value={20}>20 races</option>
                <option value={30}>30 races</option>
                <option value={50}>50 races (max)</option>
              </select>
            </div>

            <div className="text-sm text-muted-foreground">
              This will import World Cup, HC, and C1 races from XCOdata.com.
              Scraping is rate-limited, so importing may take several minutes.
            </div>

            <Button
              onClick={handleImport}
              disabled={importing}
              className="w-full"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing... (this takes a while)
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Start Import
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Import Complete!</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 bg-muted rounded">
                <div className="font-medium">{result.processed}</div>
                <div className="text-muted-foreground">Races processed</div>
              </div>
              <div className="p-2 bg-muted rounded">
                <div className="font-medium">{result.resultsCreated}</div>
                <div className="text-muted-foreground">Results imported</div>
              </div>
              <div className="p-2 bg-muted rounded">
                <div className="font-medium">{result.ridersCreated}</div>
                <div className="text-muted-foreground">New riders</div>
              </div>
              <div className="p-2 bg-muted rounded">
                <div className="font-medium">{result.eventsCreated}</div>
                <div className="text-muted-foreground">Events created</div>
              </div>
            </div>

            {result.processedRaces.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Imported races:</div>
                <div className="text-xs text-muted-foreground max-h-32 overflow-y-auto">
                  {result.processedRaces.map((name, i) => (
                    <div key={i}>• {name}</div>
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setOpen(false);
              }}
              className="w-full"
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
