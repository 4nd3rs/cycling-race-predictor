"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelector } from "@/components/category-selector";
import { toast } from "sonner";
import type {
  ParsedUrlResponse,
  ParsedCategory,
  ParsedPdf,
} from "@/app/api/races/parse-url/route";

// Convert ParsedCategory to the format CategorySelector expects
interface CategoryForSelector {
  key: string;
  ageCategory: string;
  gender: string;
  displayName: string;
  riderCount: number;
}

export default function NewRacePage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [raceUrl, setRaceUrl] = useState("");
  const [pdfStartlistUrl, setPdfStartlistUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Unified parsed data state
  const [parsedData, setParsedData] = useState<ParsedUrlResponse | null>(null);
  const [pdfStartlistData, setPdfStartlistData] = useState<{
    entries: Array<{
      firstName: string;
      lastName: string;
      name: string;
      teamName: string | null;
      nationality: string;
      uciId: string | null;
      gender: string;
      category: string;
    }>;
    categories: Array<{
      key: string;
      displayName: string;
      riderCount: number;
    }>;
  } | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedPdfUrls, setSelectedPdfUrls] = useState<string[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    date: "",
    discipline: "road",
    profileType: "",
    uciCategory: "",
    country: "",
    distanceKm: "",
    elevationM: "",
  });

  // Update form when parsed data changes
  useEffect(() => {
    if (!parsedData) return;

    // Calculate all new values first
    let newFormData = {
      name: parsedData.name || "",
      date: parsedData.date || "",
      country: parsedData.country || "",
      profileType: parsedData.profileType || "",
      uciCategory: "",
      distanceKm: parsedData.distance?.toString() || "",
      elevationM: parsedData.elevation?.toString() || "",
      discipline: parsedData.source.discipline === "road" ? "road" : "mtb_xco",
    };

    let newSelectedCategories: string[] = [];
    let newSelectedPdfUrls: string[] = [];

    // Auto-select all categories for MTB events
    if (parsedData.categories && parsedData.categories.length > 0) {
      newSelectedCategories = parsedData.categories.map((c) => c.key);
    }

    // Auto-select PDFs for Copa Catalana
    // Prefer actual race results (with "Carrera" in URL) over championship standings
    if (parsedData.pdfs && parsedData.pdfs.length > 0) {
      // Find first PDF that's an actual race (has "Carrera" in URL) in most recent year
      const raceResultPdfs = parsedData.pdfs.filter(
        (p) => p.url.toLowerCase().includes("carrera")
      );
      const firstPdf = raceResultPdfs.length > 0 ? raceResultPdfs[0] : parsedData.pdfs[0];
      const relatedPdfs = parsedData.pdfs.filter(
        (p) => p.raceName === firstPdf.raceName && p.year === firstPdf.year
      );
      newSelectedPdfUrls = relatedPdfs.map((p) => p.url);

      if (firstPdf.raceDate) {
        newFormData = {
          ...newFormData,
          date: firstPdf.raceDate || newFormData.date,
          name: firstPdf.raceName
            ? `Copa Catalana - ${firstPdf.raceName} ${firstPdf.year || ""}`.trim()
            : newFormData.name,
        };
      }
    }

    // Apply all state updates in a transition
    startTransition(() => {
      setFormData(newFormData);
      setSelectedCategories(newSelectedCategories);
      setSelectedPdfUrls(newSelectedPdfUrls);
    });
  }, [parsedData]);

  const handleParsePdfStartlist = async () => {
    if (!pdfStartlistUrl && !pdfFile) {
      toast.error("Please select a PDF file or enter a URL");
      return;
    }

    setIsParsingPdf(true);
    setPdfStartlistData(null);

    try {
      let response;

      if (pdfFile) {
        // Upload file
        const formData = new FormData();
        formData.append("file", pdfFile);

        response = await fetch("/api/races/parse-pdf-startlist", {
          method: "POST",
          body: formData,
        });
      } else {
        // Use URL
        response = await fetch("/api/races/parse-pdf-startlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfUrl: pdfStartlistUrl }),
        });
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to parse PDF");
      }

      const data = await response.json();

      startTransition(() => {
        setPdfStartlistData(data);
        // Auto-select all categories from PDF
        if (data.categories) {
          setSelectedCategories(data.categories.map((c: { key: string }) => c.key));
        }
        // Update form with any extracted info
        if (data.name && !formData.name) {
          setFormData((prev) => ({ ...prev, name: data.name }));
        }
        if (data.date && !formData.date) {
          setFormData((prev) => ({ ...prev, date: data.date }));
        }
      });

      toast.success(
        `Parsed ${data.supportedRiderCount} riders across ${data.categories?.length || 0} categories`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to parse PDF");
    } finally {
      setIsParsingPdf(false);
    }
  };

  const handleParseUrl = async () => {
    if (!raceUrl) {
      toast.error("Please enter a race URL");
      return;
    }

    setIsParsing(true);
    setParsedData(null);
    setPdfStartlistData(null);
    setPdfStartlistUrl("");
    setSelectedCategories([]);
    setSelectedPdfUrls([]);

    try {
      const response = await fetch("/api/races/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raceUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || "Failed to parse URL");
      }

      const data: ParsedUrlResponse = await response.json();

      // Use startTransition for non-urgent state update
      startTransition(() => {
        setParsedData(data);
      });

      // Delay toast to avoid DOM conflicts with React reconciliation
      const sourceName = data.source.displayName;
      setTimeout(() => {
        if (data.pdfs && data.pdfs.length > 0) {
          toast.success(`Found ${data.pdfs.length} result PDFs from ${sourceName}`);
        } else if (data.categories && data.categories.length > 0) {
          const totalRiders = data.totalEntries || 0;
          toast.success(
            `Found ${data.categories.length} categories with ${totalRiders} riders from ${sourceName}`
          );
        } else if (data.totalEntries && data.totalEntries > 0) {
          toast.success(`Found ${data.totalEntries} riders from ${sourceName}`);
        } else {
          toast.success(`Parsed race info from ${sourceName}`);
        }
      }, 100);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to parse URL");
    } finally {
      setIsParsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // For PDF imports, date comes from PDF so only name is required
    const dateRequired = !hasPdfs;
    if (!formData.name || (dateRequired && !formData.date)) {
      toast.error("Please fill in required fields");
      return;
    }

    setIsSubmitting(true);

    try {
      // For sources with categories (MTB)
      if (parsedData?.source.hasCategories && selectedCategories.length === 0) {
        toast.error("Please select at least one category");
        setIsSubmitting(false);
        return;
      }

      // For sources with PDFs (Copa Catalana)
      if (parsedData?.source.hasPdfs && selectedPdfUrls.length === 0) {
        toast.error("Please select at least one PDF to import");
        setIsSubmitting(false);
        return;
      }

      // For sources requiring PDF upload
      if (requiresPdfUpload && !pdfStartlistData) {
        toast.error("Please upload and parse a PDF startlist first");
        setIsSubmitting(false);
        return;
      }

      // Use PDF startlist entries if available, otherwise use parsedData entries
      const entries = pdfStartlistData?.entries || parsedData?.entries;

      const response = await fetch("/api/races/create-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: raceUrl,
          name: formData.name,
          date: formData.date,
          country: formData.country || null,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
          pdfUrls: selectedPdfUrls.length > 0 ? selectedPdfUrls : undefined,
          entries: entries,
          profileType: formData.profileType || undefined,
          uciCategory: formData.uciCategory || undefined,
          distanceKm: formData.distanceKm ? parseFloat(formData.distanceKm) : undefined,
          elevationM: formData.elevationM ? parseInt(formData.elevationM) : undefined,
          pcsUrl: parsedData?.pcsUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create race");
      }

      const data = await response.json();

      // Show success message based on what was created
      if (data.totalRaces) {
        toast.success(
          `Created ${data.totalRaces} races with ${data.totalRiders || data.totalResults || 0} entries!`
        );
      } else {
        toast.success("Race created successfully!");
      }

      // Navigate to the created race/event using new URL format
      if (data.eventSlug && data.discipline) {
        // New format: /races/mtb/event-slug
        router.push(`/races/${data.discipline}/${data.eventSlug}`);
      } else if (data.races && data.races.length > 0) {
        router.push(`/races/${data.races[0].id}`);
      } else if (data.id) {
        router.push(`/races/${data.id}`);
      } else {
        router.push("/races");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create race");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Derived state
  const isMultiCategory = parsedData?.source.hasCategories || false;
  const hasPdfs = parsedData?.source.hasPdfs || false;
  const requiresPdfUpload = (parsedData?.source as { requiresPdfUpload?: boolean })?.requiresPdfUpload || false;
  const hasPdfStartlist = pdfStartlistData !== null;
  const isRoad = parsedData?.source.discipline === "road";
  // Use PDF startlist categories if available, otherwise parsed URL categories
  const categoriesForSelector: CategoryForSelector[] = pdfStartlistData?.categories
    ? pdfStartlistData.categories.map((c) => ({
        key: c.key,
        ageCategory: c.key.split("_")[0],
        gender: c.key.split("_")[1],
        displayName: c.displayName,
        riderCount: c.riderCount || 0,
      }))
    : (parsedData?.categories || []).map((c: ParsedCategory) => ({
        key: c.key,
        ageCategory: c.ageCategory,
        gender: c.gender,
        displayName: c.displayName,
        riderCount: c.riderCount || 0,
      }));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-2xl">
        <SignedOut>
          <Card className="max-w-md mx-auto mt-12">
            <CardHeader className="text-center">
              <CardTitle>Sign in Required</CardTitle>
              <CardDescription>
                You need to be signed in to add new races.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <SignInButton mode="modal">
                <Button>Sign In</Button>
              </SignInButton>
            </CardContent>
          </Card>
        </SignedOut>

        <SignedIn>
        <h1 className="text-3xl font-bold mb-2">Add New Race</h1>
        <p className="text-muted-foreground mb-8">
          Paste a race URL to automatically extract details. We support many sources including ProCyclingStats, Rockthesport, and Copa Catalana.
        </p>

        <div className="space-y-6">
          {/* Race URL Section */}
          <Card>
            <CardHeader>
              <CardTitle>Race URL</CardTitle>
              <CardDescription>
                Paste a link to a race page. We&apos;ll detect the source and extract the relevant data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="raceUrl">Race URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="raceUrl"
                    placeholder="https://www.procyclingstats.com/... or https://www.copacatalanabtt.com/..."
                    value={raceUrl}
                    onChange={(e) => setRaceUrl(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleParseUrl}
                    disabled={isParsing || !raceUrl}
                  >
                    {isParsing ? "Parsing..." : "Parse"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supported: procyclingstats.com, rockthesport.com, copacatalanabtt.com
                </p>
              </div>

              {/* Parsed data summary */}
              {parsedData && (
                <div
                  className={`p-4 border rounded-lg space-y-2 ${
                    parsedData.source.discipline === "road"
                      ? "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
                      : "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"
                  }`}
                >
                  <p
                    className={`text-sm font-medium ${
                      parsedData.source.discipline === "road"
                        ? "text-blue-800 dark:text-blue-200"
                        : "text-orange-800 dark:text-orange-200"
                    }`}
                  >
                    ✓ {parsedData.source.displayName} detected
                  </p>
                  <div
                    className={`text-sm space-y-1 ${
                      parsedData.source.discipline === "road"
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-orange-700 dark:text-orange-300"
                    }`}
                  >
                    {parsedData.name && (
                      <p>
                        <strong>Name:</strong> {parsedData.name}
                      </p>
                    )}
                    {parsedData.date && (
                      <p>
                        <strong>Date:</strong> {parsedData.date}
                      </p>
                    )}
                    {parsedData.country && (
                      <p>
                        <strong>Country:</strong> {parsedData.country}
                      </p>
                    )}
                    {parsedData.totalEntries !== undefined && parsedData.totalEntries > 0 && (
                      <p>
                        <strong>Riders:</strong> {parsedData.totalEntries}
                      </p>
                    )}
                    {parsedData.categories && parsedData.categories.length > 0 && (
                      <p>
                        <strong>Categories:</strong>{" "}
                        {parsedData.categories.map((c) => c.displayName).join(", ")}
                      </p>
                    )}
                    {parsedData.pdfs && parsedData.pdfs.length > 0 && (
                      <p>
                        <strong>Result PDFs:</strong> {parsedData.pdfs.length}
                      </p>
                    )}
                    {requiresPdfUpload && (
                      <p className="mt-2 font-medium">
                        ⚠️ This source requires a PDF startlist upload
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PDF Startlist Upload (for sources that require it) */}
          {requiresPdfUpload && parsedData && (
            <Card>
              <CardHeader>
                <CardTitle>Upload Startlist PDF</CardTitle>
                <CardDescription>
                  This source doesn&apos;t provide startlist data directly. Upload a PDF or provide a URL.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* File Upload */}
                <div className="space-y-2">
                  <Label htmlFor="pdfFile">PDF File</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pdfFile"
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setPdfFile(file);
                        if (file) setPdfStartlistUrl(""); // Clear URL when file is selected
                      }}
                      className="file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleParsePdfStartlist}
                      disabled={isParsingPdf || (!pdfFile && !pdfStartlistUrl)}
                    >
                      {isParsingPdf ? "Parsing..." : "Parse PDF"}
                    </Button>
                  </div>
                  {pdfFile && (
                    <p className="text-xs text-muted-foreground">
                      Selected: {pdfFile.name}
                    </p>
                  )}
                </div>

                {/* Or use URL */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or use URL</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pdfStartlistUrl">PDF URL</Label>
                  <Input
                    id="pdfStartlistUrl"
                    placeholder="https://example.com/startlist.pdf"
                    value={pdfStartlistUrl}
                    onChange={(e) => {
                      setPdfStartlistUrl(e.target.value);
                      if (e.target.value) setPdfFile(null); // Clear file when URL is entered
                    }}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Supports UCI-style entry lists with categories like Elite, U23, Junior
                </p>

                {/* PDF Parse Results */}
                {pdfStartlistData && (
                  <div className="p-4 border rounded-lg space-y-2 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      ✓ PDF parsed successfully
                    </p>
                    <div className="text-sm space-y-1 text-green-700 dark:text-green-300">
                      <p>
                        <strong>Riders:</strong> {pdfStartlistData.entries?.length || 0}
                      </p>
                      <p>
                        <strong>Categories:</strong>{" "}
                        {pdfStartlistData.categories?.map((c) => `${c.displayName} (${c.riderCount})`).join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* PDF Selection (for Copa Catalana-style sources) */}
          {hasPdfs && parsedData?.pdfs && parsedData.pdfs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Select Results PDFs</CardTitle>
                <CardDescription>
                  Select all PDFs for the same race event. For example, one PDF may have Elite/U23 Men and another has Women/Junior.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Group PDFs by year and race name */}
                {(() => {
                  const pdfsByYearAndRace = new Map<string, Map<string, ParsedPdf[]>>();
                  parsedData.pdfs.forEach((pdf: ParsedPdf) => {
                    const year = pdf.year || "Unknown";
                    const raceName = pdf.raceName || "Unknown Race";
                    if (!pdfsByYearAndRace.has(year)) {
                      pdfsByYearAndRace.set(year, new Map());
                    }
                    const yearMap = pdfsByYearAndRace.get(year)!;
                    if (!yearMap.has(raceName)) {
                      yearMap.set(raceName, []);
                    }
                    yearMap.get(raceName)!.push(pdf);
                  });

                  // Sort years descending
                  const sortedYears = Array.from(pdfsByYearAndRace.keys()).sort((a, b) => {
                    if (a === "Unknown") return 1;
                    if (b === "Unknown") return -1;
                    return parseInt(b) - parseInt(a);
                  });

                  return sortedYears.map((year) => (
                    <div key={year} className="space-y-3">
                      <h4 className="font-semibold text-sm text-muted-foreground border-b pb-1">
                        {year}
                      </h4>
                      <div className="space-y-4 pl-2">
                        {Array.from(pdfsByYearAndRace.get(year)!.entries()).map(
                          ([raceName, pdfs]) => {
                            const allSelected = pdfs.every((p) =>
                              selectedPdfUrls.includes(p.url)
                            );
                            const someSelected = pdfs.some((p) =>
                              selectedPdfUrls.includes(p.url)
                            );
                            const allCategories = pdfs.flatMap(
                              (p) => p.suggestedCategories
                            );
                            const firstPdf = pdfs[0];

                            return (
                              <div key={raceName} className="space-y-2">
                                {/* Race header with select all */}
                                <label
                                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                                    allSelected
                                      ? "border-orange-500 bg-orange-50 dark:bg-orange-950"
                                      : someSelected
                                      ? "border-orange-300 bg-orange-25 dark:bg-orange-975"
                                      : "border-border hover:border-orange-300"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                      if (el) el.indeterminate = someSelected && !allSelected;
                                    }}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        // Select all PDFs for this race
                                        const newUrls = [
                                          ...selectedPdfUrls,
                                          ...pdfs
                                            .map((p) => p.url)
                                            .filter((url) => !selectedPdfUrls.includes(url)),
                                        ];
                                        setSelectedPdfUrls(newUrls);
                                      } else {
                                        // Deselect all PDFs for this race
                                        setSelectedPdfUrls(
                                          selectedPdfUrls.filter(
                                            (url) => !pdfs.some((p) => p.url === url)
                                          )
                                        );
                                      }
                                      // Update form data
                                      setFormData((prev) => ({
                                        ...prev,
                                        name: e.target.checked && firstPdf.raceName
                                          ? `Copa Catalana - ${firstPdf.raceName} ${firstPdf.year || ""}`.trim()
                                          : prev.name,
                                        date: e.target.checked && firstPdf.raceDate
                                          ? firstPdf.raceDate
                                          : prev.date,
                                      }));
                                    }}
                                    className="h-4 w-4"
                                    disabled={isSubmitting}
                                  />
                                  <div className="flex-1">
                                    <p className="font-medium text-sm">{raceName}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {pdfs.length} PDF{pdfs.length > 1 ? "s" : ""} -{" "}
                                      {allCategories.join(", ")}
                                    </p>
                                  </div>
                                </label>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  ));
                })()}

                {selectedPdfUrls.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {selectedPdfUrls.length} PDF{selectedPdfUrls.length > 1 ? "s" : ""} selected
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Category Selection (for multi-category sources or PDF startlists) */}
          {(isMultiCategory || hasPdfStartlist) && categoriesForSelector.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Select Categories</CardTitle>
                <CardDescription>
                  Choose which categories to create separate races for.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* If categories have rider counts (from startlist), use CategorySelector */}
                {categoriesForSelector.some((c) => c.riderCount > 0) ? (
                  <CategorySelector
                    availableCategories={categoriesForSelector}
                    selectedCategories={selectedCategories}
                    onChange={setSelectedCategories}
                    disabled={isSubmitting}
                  />
                ) : (
                  /* Otherwise show simple checkboxes (for results import) */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {categoriesForSelector.map((cat) => (
                        <label
                          key={cat.key}
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedCategories.includes(cat.key)
                              ? "border-orange-500 bg-orange-50 dark:bg-orange-950"
                              : "border-border hover:border-orange-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCategories.includes(cat.key)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCategories([...selectedCategories, cat.key]);
                              } else {
                                setSelectedCategories(
                                  selectedCategories.filter((k) => k !== cat.key)
                                );
                              }
                            }}
                            disabled={isSubmitting}
                          />
                          <span className="text-sm font-medium">{cat.displayName}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedCategories(categoriesForSelector.map((c) => c.key))
                        }
                        disabled={isSubmitting}
                      >
                        Select All
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedCategories([])}
                        disabled={isSubmitting}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Race Details Form */}
          <Card>
            <CardHeader>
              <CardTitle>{isMultiCategory || hasPdfs ? "Event Details" : "Race Details"}</CardTitle>
              <CardDescription>
                Review and edit the information. Fields are auto-filled from the parsed URL.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      {isMultiCategory || hasPdfs ? "Event Name" : "Race Name"} *
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Race/Event Name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="date">
                      Date {hasPdfs ? "(from PDF)" : "*"}
                    </Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      required={!hasPdfs}
                      readOnly={hasPdfs}
                      className={hasPdfs ? "bg-muted cursor-not-allowed" : ""}
                    />
                    {hasPdfs && (
                      <p className="text-xs text-muted-foreground">
                        Date is extracted from the PDF results
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="discipline">Discipline *</Label>
                    <Select
                      value={formData.discipline}
                      onValueChange={(value) => setFormData({ ...formData, discipline: value })}
                      disabled={!!parsedData}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select discipline" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="road">Road</SelectItem>
                        <SelectItem value="mtb_xco">MTB XCO</SelectItem>
                        <SelectItem value="mtb_xcc">MTB XCC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      name="country"
                      placeholder="ESP"
                      maxLength={3}
                      value={formData.country}
                      onChange={(e) =>
                        setFormData({ ...formData, country: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                </div>

                {/* Road race specific fields */}
                {isRoad && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="profileType">Profile Type</Label>
                        <Select
                          value={formData.profileType}
                          onValueChange={(value) =>
                            setFormData({ ...formData, profileType: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select profile" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="flat">Flat</SelectItem>
                            <SelectItem value="hilly">Hilly</SelectItem>
                            <SelectItem value="mountain">Mountain</SelectItem>
                            <SelectItem value="tt">Time Trial</SelectItem>
                            <SelectItem value="cobbles">Cobbles</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="uciCategory">UCI Category</Label>
                        <Select
                          value={formData.uciCategory}
                          onValueChange={(value) =>
                            setFormData({ ...formData, uciCategory: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2.UWT">2.UWT (Grand Tour)</SelectItem>
                            <SelectItem value="1.UWT">1.UWT (WorldTour)</SelectItem>
                            <SelectItem value="2.Pro">2.Pro</SelectItem>
                            <SelectItem value="1.Pro">1.Pro</SelectItem>
                            <SelectItem value="2.1">2.1</SelectItem>
                            <SelectItem value="1.1">1.1</SelectItem>
                            <SelectItem value="2.2">2.2</SelectItem>
                            <SelectItem value="1.2">1.2</SelectItem>
                            <SelectItem value="NC">National Championship</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="distanceKm">Distance (km)</Label>
                        <Input
                          id="distanceKm"
                          name="distanceKm"
                          type="number"
                          step="0.1"
                          placeholder="180.5"
                          value={formData.distanceKm}
                          onChange={(e) =>
                            setFormData({ ...formData, distanceKm: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="elevationM">Elevation (m)</Label>
                        <Input
                          id="elevationM"
                          name="elevationM"
                          type="number"
                          placeholder="3500"
                          value={formData.elevationM}
                          onChange={(e) =>
                            setFormData({ ...formData, elevationM: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="pt-4 space-y-3">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      isSubmitting ||
                      (isMultiCategory && selectedCategories.length === 0) ||
                      (hasPdfs && selectedPdfUrls.length === 0) ||
                      (requiresPdfUpload && !pdfStartlistData)
                    }
                  >
                    {isSubmitting
                      ? hasPdfs
                        ? "Importing from PDF... (this may take a moment)"
                        : hasPdfStartlist
                        ? "Creating races with startlist..."
                        : "Creating..."
                      : hasPdfs
                      ? `Import ${selectedCategories.length} Race${
                          selectedCategories.length !== 1 ? "s" : ""
                        } from PDF`
                      : hasPdfStartlist || isMultiCategory
                      ? `Create ${selectedCategories.length} Race${
                          selectedCategories.length !== 1 ? "s" : ""
                        }`
                      : "Create Race"}
                  </Button>
                  {isSubmitting && hasPdfs && (
                    <p className="text-sm text-center text-muted-foreground animate-pulse">
                      Parsing PDF, extracting results, and creating rider profiles...
                    </p>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
        </SignedIn>
      </main>
    </div>
  );
}
