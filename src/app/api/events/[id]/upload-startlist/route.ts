import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { db, riders, races, raceStartlist } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import {
  parseStartlistTextWithAI,
  groupEntriesByCategory,
  type StartlistEntry,
} from "@/lib/scraper/pdf-startlist-parser";
// @ts-expect-error - pdf-parse v1.x doesn't have types
import pdfParse from "pdf-parse/lib/pdf-parse.js";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Normalize name for fuzzy matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/**
 * Try to match a parsed entry to an existing rider by name
 */
function findRiderMatch(
  entry: StartlistEntry,
  existingRiders: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const entryFullName = normalizeName(`${entry.firstName} ${entry.lastName}`);
  const entryReversed = normalizeName(`${entry.lastName} ${entry.firstName}`);

  // Try exact match
  for (const rider of existingRiders) {
    const riderNorm = normalizeName(rider.name);
    if (riderNorm === entryFullName || riderNorm === entryReversed) {
      return rider;
    }
  }

  // Try partial match: last name + first 3 chars of first name
  const lastName = normalizeName(entry.lastName);
  const firstName = normalizeName(entry.firstName);

  for (const rider of existingRiders) {
    const riderParts = normalizeName(rider.name).split(/\s+/);
    if (riderParts.length < 2) continue;

    // Try "FirstName LastName" format
    const riderFirst = riderParts[0];
    const riderLast = riderParts.slice(1).join(" ");
    if (
      lastName === riderLast &&
      (firstName === riderFirst ||
        (firstName.length >= 3 && riderFirst.length >= 3 &&
          (firstName.startsWith(riderFirst.substring(0, 3)) ||
            riderFirst.startsWith(firstName.substring(0, 3)))))
    ) {
      return rider;
    }

    // Try "LastName FirstName" format
    const riderLast2 = riderParts[0];
    const riderFirst2 = riderParts.slice(1).join(" ");
    if (
      lastName === riderLast2 &&
      (firstName === riderFirst2 ||
        (firstName.length >= 3 && riderFirst2.length >= 3 &&
          (firstName.startsWith(riderFirst2.substring(0, 3)) ||
            riderFirst2.startsWith(firstName.substring(0, 3)))))
    ) {
      return rider;
    }
  }

  return null;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: eventId } = await context.params;

  try {
    // Parse the PDF from file upload or URL
    const contentType = request.headers.get("content-type") || "";
    let parsedData;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      console.log(`[Upload-Startlist] Parsing file: ${file.name} (${buffer.length} bytes)`);

      const text = await extractPdfText(buffer);
      if (!text || text.trim().length < 50) {
        return NextResponse.json(
          { error: "Could not extract text from PDF. The file may be scanned/image-based." },
          { status: 400 }
        );
      }

      parsedData = await parseStartlistTextWithAI(text);
    } else {
      const { pdfUrl } = await request.json();
      if (!pdfUrl) {
        return NextResponse.json({ error: "PDF URL or file required" }, { status: 400 });
      }

      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        return NextResponse.json(
          { error: `Failed to download PDF: ${pdfResponse.status}` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await pdfResponse.arrayBuffer());
      const text = await extractPdfText(buffer);
      parsedData = await parseStartlistTextWithAI(text);
    }

    if (!parsedData || parsedData.entries.length === 0) {
      return NextResponse.json(
        { error: "No riders found in PDF. Check the file format." },
        { status: 400 }
      );
    }

    // Group parsed entries by category
    const grouped = groupEntriesByCategory(parsedData.entries, parsedData.categories);

    // Get all races for this event
    const eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, eventId));

    if (eventRaces.length === 0) {
      return NextResponse.json({ error: "No races found for this event" }, { status: 404 });
    }

    let totalMatched = 0;
    let totalNotFound = 0;
    const categoryResults: Array<{
      category: string;
      matched: number;
      notFound: number;
      total: number;
    }> = [];

    // For each category group, match to the correct race and update bib numbers
    for (const [categoryKey, entries] of grouped) {
      const [ageCategory, gender] = categoryKey.split("_");

      // Find the matching race
      const race = eventRaces.find(
        (r) => r.ageCategory === ageCategory && r.gender === gender
      );

      if (!race) {
        console.log(`[Upload-Startlist] No race found for ${categoryKey}, skipping`);
        continue;
      }

      // Get existing startlist entries with rider info
      const startlistEntries = await db
        .select({
          entry: raceStartlist,
          rider: riders,
        })
        .from(raceStartlist)
        .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
        .where(eq(raceStartlist.raceId, race.id));

      const existingRiders = startlistEntries.map(({ rider }) => ({
        id: rider.id,
        name: rider.name,
      }));

      // Build a map of rider ID -> startlist entry ID for quick lookup
      const entryByRiderId = new Map(
        startlistEntries.map(({ entry, rider }) => [rider.id, entry.id])
      );

      let matched = 0;
      let notFoundCount = 0;

      for (const pdfEntry of entries) {
        if (!pdfEntry.bibNumber) continue;

        const riderMatch = findRiderMatch(pdfEntry, existingRiders);
        if (riderMatch) {
          const entryId = entryByRiderId.get(riderMatch.id);
          if (entryId) {
            await db
              .update(raceStartlist)
              .set({ bibNumber: pdfEntry.bibNumber })
              .where(eq(raceStartlist.id, entryId));
            matched++;
          }
        } else {
          notFoundCount++;
          console.log(
            `[Upload-Startlist] No match for: ${pdfEntry.firstName} ${pdfEntry.lastName} (bib ${pdfEntry.bibNumber}) in ${categoryKey}`
          );
        }
      }

      totalMatched += matched;
      totalNotFound += notFoundCount;

      const displayName = `${ageCategory === "elite" ? "Elite" : ageCategory === "u23" ? "U23" : "Junior"} ${gender === "men" ? "Men" : "Women"}`;
      categoryResults.push({
        category: displayName,
        matched,
        notFound: notFoundCount,
        total: entries.length,
      });

      console.log(
        `[Upload-Startlist] ${displayName}: ${matched}/${entries.length} matched, ${notFoundCount} not found`
      );
    }

    return NextResponse.json({
      success: true,
      totalMatched,
      totalNotFound,
      totalParsed: parsedData.entries.length,
      categories: categoryResults,
      message: `Updated bib numbers for ${totalMatched} riders across ${categoryResults.length} categories.`,
    });
  } catch (error) {
    console.error("Error uploading startlist:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to process startlist: ${errorMessage}` },
      { status: 500 }
    );
  }
}
