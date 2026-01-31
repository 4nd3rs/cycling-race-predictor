"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";

export default function NewRacePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startlistUrl, setStartlistUrl] = useState("");
  const [parsedData, setParsedData] = useState<{
    name?: string;
    date?: string;
    riderCount?: number;
  } | null>(null);

  const handleParseStartlist = async () => {
    if (!startlistUrl) {
      toast.error("Please enter a startlist URL");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/races/parse-startlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: startlistUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to parse startlist");
      }

      const data = await response.json();
      setParsedData(data);
      toast.success(`Found ${data.riderCount} riders`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to parse startlist");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/races", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          date: formData.get("date"),
          discipline: formData.get("discipline"),
          profileType: formData.get("profileType"),
          uciCategory: formData.get("uciCategory"),
          country: formData.get("country"),
          distanceKm: formData.get("distanceKm"),
          elevationM: formData.get("elevationM"),
          startlistUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create race");
      }

      const data = await response.json();
      toast.success("Race created successfully!");
      router.push(`/races/${data.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create race");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-8 max-w-2xl">
        <h1 className="text-3xl font-bold mb-2">Add New Race</h1>
        <p className="text-muted-foreground mb-8">
          Submit a race by providing an official startlist URL. The system will
          parse rider data and generate predictions.
        </p>

        <div className="space-y-6">
          {/* Startlist URL Section */}
          <Card>
            <CardHeader>
              <CardTitle>Startlist Source</CardTitle>
              <CardDescription>
                Provide a URL to an official startlist from ProCyclingStats,
                FirstCycling, or an official race website.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="startlistUrl">Startlist URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="startlistUrl"
                    placeholder="https://www.procyclingstats.com/race/.../startlist"
                    value={startlistUrl}
                    onChange={(e) => setStartlistUrl(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleParseStartlist}
                    disabled={isSubmitting || !startlistUrl}
                  >
                    {isSubmitting ? "Parsing..." : "Parse"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supported: procyclingstats.com, firstcycling.com, official race sites
                </p>
              </div>

              {parsedData && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    ✓ Found {parsedData.riderCount} riders
                    {parsedData.name && ` for ${parsedData.name}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Race Details Form */}
          <Card>
            <CardHeader>
              <CardTitle>Race Details</CardTitle>
              <CardDescription>
                Fill in the race information. Some fields may be auto-filled from
                the startlist.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Race Name *</Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Tour de France Stage 1"
                      defaultValue={parsedData?.name || ""}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="date">Date *</Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      defaultValue={parsedData?.date || ""}
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="discipline">Discipline *</Label>
                    <Select name="discipline" defaultValue="road">
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
                    <Label htmlFor="profileType">Profile Type</Label>
                    <Select name="profileType">
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
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="uciCategory">UCI Category</Label>
                    <Select name="uciCategory">
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WorldTour">WorldTour</SelectItem>
                        <SelectItem value="2.Pro">2.Pro</SelectItem>
                        <SelectItem value="1.Pro">1.Pro</SelectItem>
                        <SelectItem value="2.1">2.1</SelectItem>
                        <SelectItem value="1.1">1.1</SelectItem>
                        <SelectItem value="2.2">2.2</SelectItem>
                        <SelectItem value="1.2">1.2</SelectItem>
                        <SelectItem value="National">National Championship</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      name="country"
                      placeholder="FRA"
                      maxLength={3}
                    />
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="elevationM">Elevation (m)</Label>
                    <Input
                      id="elevationM"
                      name="elevationM"
                      type="number"
                      placeholder="3500"
                    />
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Creating Race..." : "Create Race"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
