import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, parseStartlistSchema } from "@/lib/validations";
import { scrapeRacePage } from "@/lib/scraper/pcs";
import {
  parseStartlist,
  isValidStartlistUrl,
  detectSourceType,
} from "@/lib/scraper/startlist-parser";

export async function POST(request: Request) {
  // Rate limit (stricter for scraping)
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate body
  const { data, error } = await validateBody(request, parseStartlistSchema);
  if (error) return error;

  // Validate URL format
  if (!isValidStartlistUrl(data.url)) {
    return NextResponse.json(
      { error: "Invalid URL. Please provide a valid race URL." },
      { status: 400 }
    );
  }

  try {
    const sourceType = detectSourceType(data.url);

    // For PCS URLs, use the enhanced race page scraper
    if (sourceType === "pcs") {
      const result = await scrapeRacePage(data.url);

      if (!result) {
        return NextResponse.json(
          { error: "Could not parse race page. Please check the URL." },
          { status: 400 }
        );
      }

      return NextResponse.json({
        // Race info
        name: result.race.name,
        date: result.race.date,
        country: result.race.country,
        category: result.race.category,
        profileType: result.race.profileType,
        distance: result.race.distance,
        elevation: result.race.elevation,
        pcsUrl: result.race.pcsUrl,
        startlistUrl: result.race.startlistUrl,
        // Stage race info
        isStageRace: result.isStageRace,
        stages: result.stages,
        // Startlist - return ALL entries for race creation
        source: "ProCyclingStats",
        riderCount: result.startlist.length,
        entries: result.startlist, // All entries
        hasStartlist: result.startlist.length > 0,
      });
    }

    // For other sources, use the generic parser
    const startlist = await parseStartlist(data.url);

    return NextResponse.json({
      name: startlist.raceName,
      date: startlist.raceDate,
      source: startlist.source,
      riderCount: startlist.entries.length,
      entries: startlist.entries, // All entries
      hasStartlist: startlist.entries.length > 0,
    });
  } catch (err) {
    console.error("Error parsing race URL:", err);
    return NextResponse.json(
      { error: "Failed to parse race page. Please check the URL and try again." },
      { status: 400 }
    );
  }
}
