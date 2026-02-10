import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, parseMtbEventSchema } from "@/lib/validations";
import {
  scrapeRockthesportEvent,
  detectRockthesportUrl,
  mapCategory,
  groupEntriesByCategory,
  getCategoryDisplayName,
} from "@/lib/scraper/rockthesport";
import { detectSourceType } from "@/lib/scraper/startlist-parser";

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
  const { data, error } = await validateBody(request, parseMtbEventSchema);
  if (error) return error;

  const sourceType = detectSourceType(data.url);

  // Currently only Rockthesport is supported for MTB events
  if (sourceType !== "rockthesport") {
    return NextResponse.json(
      {
        error: "Unsupported URL. Currently only rockthesport.com URLs are supported for MTB events.",
        supportedSources: ["rockthesport.com"],
      },
      { status: 400 }
    );
  }

  try {
    const event = await scrapeRockthesportEvent(data.url);

    if (!event) {
      return NextResponse.json(
        { error: "Could not parse event. Please check the URL and try again." },
        { status: 400 }
      );
    }

    // Group entries by supported categories
    const grouped = groupEntriesByCategory(event.entries);

    // Build category summary
    const categories: Array<{
      key: string;
      ageCategory: string;
      gender: string;
      displayName: string;
      riderCount: number;
    }> = [];

    for (const [key, entries] of grouped) {
      const [ageCategory, gender] = key.split("_");
      const mapping = { ageCategory: ageCategory as "elite" | "u23" | "junior", gender: gender as "men" | "women" };
      categories.push({
        key,
        ageCategory,
        gender,
        displayName: getCategoryDisplayName(mapping),
        riderCount: entries.length,
      });
    }

    // Sort categories: Elite Men, Elite Women, U23 Men, U23 Women, Junior Men, Junior Women
    const categoryOrder = ["elite_men", "elite_women", "u23_men", "u23_women", "junior_men", "junior_women"];
    categories.sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key));

    // Calculate totals
    const supportedRiderCount = Array.from(grouped.values()).reduce((sum, entries) => sum + entries.length, 0);
    const unsupportedCount = event.entries.length - supportedRiderCount;

    return NextResponse.json({
      // Event info
      name: event.name,
      date: event.date,
      country: event.country,
      sourceUrl: data.url,
      sourceType: "rockthesport",

      // Categories
      categories,
      rawCategories: event.categories, // Original category names from source

      // Rider counts
      totalRiders: event.entries.length,
      supportedRiderCount,
      unsupportedCount, // Cadets, Masters, etc.

      // All entries (for race creation)
      entries: event.entries,

      // Filtered entries by category
      entriesByCategory: Object.fromEntries(
        Array.from(grouped.entries()).map(([key, entries]) => [
          key,
          entries.map((e) => ({
            firstName: e.firstName,
            lastName: e.lastName,
            category: e.category,
            teamName: e.teamName,
            clubName: e.clubName,
            nationality: e.nationality,
            bibNumber: e.bibNumber,
          })),
        ])
      ),
    });
  } catch (err) {
    console.error("Error parsing MTB event:", err);
    return NextResponse.json(
      { error: "Failed to parse event. Please check the URL and try again." },
      { status: 400 }
    );
  }
}
