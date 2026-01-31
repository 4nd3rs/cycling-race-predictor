import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { validateBody, parseStartlistSchema } from "@/lib/validations";
import {
  parseStartlist,
  isValidStartlistUrl,
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
      { error: "Invalid startlist URL" },
      { status: 400 }
    );
  }

  try {
    const startlist = await parseStartlist(data.url);

    return NextResponse.json({
      name: startlist.raceName,
      date: startlist.raceDate,
      source: startlist.source,
      riderCount: startlist.entries.length,
      entries: startlist.entries.slice(0, 10), // Preview first 10
    });
  } catch (error) {
    console.error("Error parsing startlist:", error);
    return NextResponse.json(
      { error: "Failed to parse startlist. Please check the URL." },
      { status: 400 }
    );
  }
}
