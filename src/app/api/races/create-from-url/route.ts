import { NextRequest, NextResponse } from "next/server";
import { detectSource, SourceType } from "@/lib/scraper/source-detector";
import { z } from "zod";

/**
 * Unified Race/Event Creation API
 *
 * Creates races from parsed URL data, routing to the appropriate
 * creation logic based on source type.
 */

const createFromUrlSchema = z.object({
  sourceUrl: z.string().url(),
  name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  country: z.string().max(3).optional(),
  // For multi-category events (MTB)
  categories: z.array(z.string()).optional(),
  // For PCS/road races and PDF startlists
  entries: z.array(z.object({
    name: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    teamName: z.string().nullable().optional(),
    pcsId: z.string().optional(),
    category: z.string().optional(),
    // PDF startlist specific fields
    uciId: z.string().nullable().optional(),
    nationality: z.string().optional(),
    gender: z.enum(["M", "W"]).optional(),
    bibNumber: z.number().nullable().optional(),
  })).optional(),
  // For Copa Catalana (PDF-based results) - can be single or multiple
  pdfUrl: z.string().url().optional(),
  pdfUrls: z.array(z.string().url()).optional(),
  // Road race specific
  profileType: z.string().optional(),
  uciCategory: z.string().optional(),
  distanceKm: z.number().optional(),
  elevationM: z.number().optional(),
  pcsUrl: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = createFromUrlSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Extract auth headers to forward to internal API calls
    const authHeaders: Record<string, string> = {};
    const cookie = request.headers.get("cookie");
    if (cookie) {
      authHeaders["cookie"] = cookie;
    }
    const authorization = request.headers.get("authorization");
    if (authorization) {
      authHeaders["authorization"] = authorization;
    }

    const data = validation.data;
    const source = detectSource(data.sourceUrl);

    if (source.sourceType === "unknown") {
      return NextResponse.json(
        { error: "Unsupported source URL" },
        { status: 400 }
      );
    }

    // Route to appropriate creation logic
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    let result;

    switch (source.sourceType as SourceType) {
      case "procyclingstats":
        result = await createFromPcs(baseUrl, data, authHeaders);
        break;
      case "rockthesport":
      case "cronomancha":
        result = await createFromMtbEvent(baseUrl, data, source.sourceType, authHeaders);
        break;
      case "copa_catalana":
        result = await createFromCopaCatalana(baseUrl, data, authHeaders);
        break;
      default:
        return NextResponse.json(
          { error: `Source ${source.sourceType} creation not yet implemented` },
          { status: 501 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error creating from URL:", error);
    return NextResponse.json(
      { error: "Failed to create race/event", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * Create race from ProCyclingStats data
 */
async function createFromPcs(baseUrl: string, data: z.infer<typeof createFromUrlSchema>, authHeaders: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/races`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      name: data.name,
      date: data.date,
      discipline: "road",
      profileType: data.profileType || null,
      uciCategory: data.uciCategory || null,
      country: data.country || null,
      distanceKm: data.distanceKm || null,
      elevationM: data.elevationM || null,
      startlistUrl: data.sourceUrl,
      pcsUrl: data.pcsUrl || null,
      startlistEntries: data.entries?.map(e => ({
        riderName: e.name,
        riderPcsId: e.pcsId,
        teamName: e.teamName,
      })) || [],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create road race");
  }

  return response.json();
}

/**
 * Create MTB event from Rockthesport, Cronomancha, or other MTB sources
 */
async function createFromMtbEvent(
  baseUrl: string,
  data: z.infer<typeof createFromUrlSchema>,
  sourceType: SourceType,
  authHeaders: Record<string, string>
) {
  const response = await fetch(`${baseUrl}/api/races/create-mtb-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      name: data.name,
      date: data.date,
      discipline: "mtb",
      subDiscipline: "xco",
      country: data.country || "ESP",
      sourceUrl: data.sourceUrl,
      sourceType: sourceType,
      categories: data.categories || [],
      entries: data.entries?.map(e => ({
        firstName: e.firstName || e.name.split(" ")[0],
        lastName: e.lastName || e.name.split(" ").slice(1).join(" "),
        teamName: e.teamName,
        category: e.category,
        // Include PDF-specific fields when available
        uciId: e.uciId,
        nationality: e.nationality,
        gender: e.gender,
        bibNumber: e.bibNumber,
      })) || [],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create MTB event");
  }

  return response.json();
}

/**
 * Create Copa Catalana event from PDF results
 */
async function createFromCopaCatalana(baseUrl: string, data: z.infer<typeof createFromUrlSchema>, authHeaders: Record<string, string>) {
  // Support both single pdfUrl and multiple pdfUrls
  const pdfUrls = data.pdfUrls || (data.pdfUrl ? [data.pdfUrl] : []);

  if (pdfUrls.length === 0) {
    throw new Error("At least one PDF URL is required for Copa Catalana");
  }

  const response = await fetch(`${baseUrl}/api/races/create-copa-catalana`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      name: data.name,
      date: data.date,
      endDate: data.endDate || data.date,
      country: data.country || "ESP",
      pdfUrls: pdfUrls,
      categories: data.categories || [],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create Copa Catalana event");
  }

  return response.json();
}
