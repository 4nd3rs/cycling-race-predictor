import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import {
  parseStartlistTextWithAI,
  groupEntriesByCategory,
  type StartlistEntry,
} from "@/lib/scraper/pdf-startlist-parser";
// @ts-expect-error - pdf-parse v1.x doesn't have types - import from lib to avoid test file bug
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * Extract text from PDF buffer
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Parse a PDF startlist file
 * Accepts either a URL to a PDF or a file upload
 */
export async function POST(request: NextRequest) {
  // Rate limit (stricter for AI-based parsing)
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    let parsedData;

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 }
        );
      }

      // Validate file type
      if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "File must be a PDF" },
          { status: 400 }
        );
      }

      // Read file as buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`[PDF-Upload] Parsing uploaded file: ${file.name} (${buffer.length} bytes)`);

      // Extract text from PDF
      const text = await extractPdfText(buffer);

      if (!text || text.trim().length < 100) {
        return NextResponse.json(
          { error: "Could not extract text from PDF. The file may be scanned or image-based." },
          { status: 400 }
        );
      }

      console.log(`[PDF-Upload] Extracted ${text.length} chars from PDF`);

      // Parse text directly (no AI needed)
      parsedData = await parseStartlistTextWithAI(text);
    } else {
      // Handle JSON body with PDF URL - download and parse
      const { pdfUrl } = await request.json();

      if (!pdfUrl) {
        return NextResponse.json(
          { error: "PDF URL is required" },
          { status: 400 }
        );
      }

      console.log(`[PDF-Upload] Downloading PDF from: ${pdfUrl}`);
      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        return NextResponse.json(
          { error: `Failed to download PDF: ${pdfResponse.status}` },
          { status: 400 }
        );
      }
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      const text = await extractPdfText(pdfBuffer);
      console.log(`[PDF-Upload] Extracted ${text.length} chars from downloaded PDF`);
      parsedData = await parseStartlistTextWithAI(text);
    }

    if (!parsedData) {
      return NextResponse.json(
        { error: "Failed to parse PDF. Please check the file format." },
        { status: 400 }
      );
    }

    // Group entries by category
    const grouped = groupEntriesByCategory(parsedData.entries, parsedData.categories);

    // Build category summary
    const categories: Array<{
      key: string;
      ageCategory: string;
      gender: string;
      displayName: string;
      riderCount: number;
    }> = [];

    const categoryOrder = ["elite_men", "elite_women", "u23_men", "u23_women", "junior_men", "junior_women"];

    for (const [key, entries] of grouped) {
      const [ageCategory, gender] = key.split("_");
      const displayName = `${ageCategory === "elite" ? "Elite" : ageCategory === "u23" ? "U23" : "Junior"} ${gender === "men" ? "Men" : "Women"}`;

      categories.push({
        key,
        ageCategory,
        gender,
        displayName,
        riderCount: entries.length,
      });
    }

    // Sort categories
    categories.sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key));

    // Calculate totals
    const supportedRiderCount = Array.from(grouped.values()).reduce((sum, entries) => sum + entries.length, 0);
    const unsupportedCount = parsedData.entries.length - supportedRiderCount;

    return NextResponse.json({
      // Event info
      name: parsedData.eventName,
      date: parsedData.date,
      location: parsedData.location,

      // Categories
      categories,
      rawCategories: parsedData.categories,

      // Rider counts
      totalRiders: parsedData.entries.length,
      supportedRiderCount,
      unsupportedCount,

      // All entries for race creation
      entries: parsedData.entries.map((e: StartlistEntry) => ({
        firstName: e.firstName,
        lastName: e.lastName,
        name: `${e.firstName} ${e.lastName}`,
        teamName: e.teamName,
        nationality: e.nationality,
        uciId: e.uciId,
        bibNumber: e.bibNumber,
        gender: e.gender,
        category: e.category,
      })),

      // Grouped entries by category
      entriesByCategory: Object.fromEntries(
        Array.from(grouped.entries()).map(([key, entries]) => [
          key,
          entries.map((e: StartlistEntry) => ({
            firstName: e.firstName,
            lastName: e.lastName,
            name: `${e.firstName} ${e.lastName}`,
            teamName: e.teamName,
            nationality: e.nationality,
            uciId: e.uciId,
            bibNumber: e.bibNumber,
            gender: e.gender,
          })),
        ])
      ),
    });
  } catch (error) {
    console.error("Error parsing PDF startlist:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Error details:", errorMessage, errorStack);
    return NextResponse.json(
      { error: `Failed to parse PDF: ${errorMessage}` },
      { status: 500 }
    );
  }
}
