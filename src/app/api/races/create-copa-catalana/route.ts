import { NextRequest, NextResponse } from "next/server";
import { db, raceEvents, races, riders, raceResults, teams } from "@/lib/db";
import { eq, ilike, and } from "drizzle-orm";
import { z } from "zod";
import {
  parseCopaCatalanaPdfUrl,
  normalizeName,
  parseTime,
  type CopaCatalanaResult,
} from "@/lib/scraper/copa-catalana";
import {
  generateEventSlug,
  generateCategorySlug,
  makeSlugUnique,
} from "@/lib/url-utils";

const createCopaCatalanaSchema = z.object({
  name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  country: z.string().length(3).optional(),
  // Support both single and multiple PDFs
  pdfUrl: z.string().url().optional(),
  pdfUrls: z.array(z.string().url()).optional(),
  categories: z.array(z.enum(["elite_men", "u23_men", "elite_women", "u23_women", "junior_men", "junior_women"])),
});

// Map PDF category to our internal format
// Men's categories: Elit, Sub23, Junior (in Carrera-1.pdf)
// Women's categories: F.Elit, F.Sub23 (in Carrera-2.pdf)
const CATEGORY_MAP: Record<string, { ageCategory: string; gender: string; pdfCategories: string[] }> = {
  elite_men: { ageCategory: "elite", gender: "men", pdfCategories: ["Elit"] },
  u23_men: { ageCategory: "u23", gender: "men", pdfCategories: ["Sub23"] },
  elite_women: { ageCategory: "elite", gender: "women", pdfCategories: ["F.Elit", "FElit", "F Elit"] },
  u23_women: { ageCategory: "u23", gender: "women", pdfCategories: ["F.Sub23", "FSub23", "F Sub23"] },
  junior_men: { ageCategory: "junior", gender: "men", pdfCategories: ["Junior"] },
  junior_women: { ageCategory: "junior", gender: "women", pdfCategories: ["F.Junior", "FJunior", "F Junior"] },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = createCopaCatalanaSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { name, date: requestDate, endDate, country, pdfUrl, pdfUrls, categories } = validation.data;

    // Get all PDF URLs (support both single and multiple)
    const allPdfUrls = pdfUrls || (pdfUrl ? [pdfUrl] : []);

    if (allPdfUrls.length === 0) {
      return NextResponse.json(
        { error: "At least one PDF URL is required" },
        { status: 400 }
      );
    }

    // Parse all PDFs and combine results, tracking source URL for each result
    const allResults: (CopaCatalanaResult & { sourceUrl: string })[] = [];
    let pdfDate: string | null = null; // Date extracted from PDF

    for (const url of allPdfUrls) {
      console.log(`Parsing Copa Catalana PDF: ${url}`);
      const parsed = await parseCopaCatalanaPdfUrl(url);

      if (parsed && parsed.results.length > 0) {
        console.log(`Found ${parsed.results.length} results in PDF`);
        // Add source URL to each result
        allResults.push(...parsed.results.map(r => ({ ...r, sourceUrl: url })));
        // Use the date from the PDF if available
        if (parsed.date && !pdfDate) {
          pdfDate = parsed.date;
          console.log(`Extracted date from PDF: ${pdfDate}`);
        }
      } else {
        console.log(`No results found in PDF: ${url}`);
      }
    }

    // Prefer the date from PDF over the request date
    const date = pdfDate || requestDate;
    console.log(`Using date: ${date} (from ${pdfDate ? 'PDF' : 'request'})`);

    if (allResults.length === 0) {
      return NextResponse.json(
        { error: "Failed to parse PDFs or no results found in any PDF" },
        { status: 400 }
      );
    }

    console.log(`Total results from ${allPdfUrls.length} PDFs: ${allResults.length}`);

    // Generate unique slug for the event
    const baseSlug = generateEventSlug(name);

    // Get existing slugs for MTB discipline
    const existingEvents = await db
      .select({ slug: raceEvents.slug })
      .from(raceEvents)
      .where(eq(raceEvents.discipline, "mtb"));

    const existingSlugs = new Set(
      existingEvents.map((e) => e.slug).filter(Boolean) as string[]
    );
    const eventSlug = makeSlugUnique(baseSlug, existingSlugs);

    // Create the event with new discipline format
    const [event] = await db.insert(raceEvents).values({
      name,
      slug: eventSlug,
      date,
      endDate: endDate || date,
      discipline: "mtb", // New format
      subDiscipline: "xco", // Store sub-discipline separately
      country: country || null,
      sourceUrl: allPdfUrls[0], // Use first PDF URL as source
      sourceType: "copa_catalana",
    }).returning();

    console.log(`Created event: ${event.id} with slug: ${eventSlug}`);

    const createdRaces: Array<{ id: string; name: string; category: string; resultsCount: number }> = [];

    // Create races and import results for each selected category
    for (const catKey of categories) {
      const catInfo = CATEGORY_MAP[catKey];
      if (!catInfo) continue;

      // Filter results for this category from all PDFs
      // Normalize category names for comparison (remove dots and spaces)
      const normalizeCategory = (cat: string) => cat.toLowerCase().replace(/[\.\s]/g, "");
      const normalizedPdfCategories = catInfo.pdfCategories.map(normalizeCategory);

      const categoryResults = allResults.filter(
        r => normalizedPdfCategories.includes(normalizeCategory(r.category))
      );

      if (categoryResults.length === 0) {
        console.log(`No results for ${catKey}`);
        continue;
      }

      // Create the race
      const raceName = `${name} - ${catInfo.ageCategory === "elite" ? "Elite" : catInfo.ageCategory === "u23" ? "U23" : "Junior"} ${catInfo.gender === "men" ? "Men" : "Women"}`;

      // Get the source PDF URL for this category (from first result)
      const categorySourceUrl = categoryResults[0]?.sourceUrl || allPdfUrls[0];

      // Generate category slug
      const categorySlug = generateCategorySlug(catInfo.ageCategory, catInfo.gender);

      const [race] = await db.insert(races).values({
        name: raceName,
        categorySlug, // Add category slug
        date,
        discipline: "mtb", // New format
        country: country || null,
        status: "completed",
        ageCategory: catInfo.ageCategory,
        gender: catInfo.gender,
        raceEventId: event.id,
        startlistUrl: categorySourceUrl, // Store the correct PDF URL for this category
      }).returning();

      console.log(`Created race: ${race.id} with ${categoryResults.length} results`);

      // Import results
      let ridersCreated = 0;
      for (const result of categoryResults) {
        const normalizedName = normalizeName(result.name);

        // Find or create rider
        let rider = await db.query.riders.findFirst({
          where: ilike(riders.name, normalizedName),
        });

        if (!rider) {
          const simpleName = normalizedName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          rider = await db.query.riders.findFirst({
            where: ilike(riders.name, simpleName),
          });
        }

        if (!rider) {
          const [newRider] = await db.insert(riders).values({
            name: normalizedName,
          }).returning();
          rider = newRider;
          ridersCreated++;
        }

        // Find or create team and link to rider
        let teamId: string | null = null;
        if (result.team) {
          let team = await db.query.teams.findFirst({
            where: ilike(teams.name, result.team),
          });

          if (!team) {
            // Insert the team
            await db.insert(teams).values({
              name: result.team,
              discipline: "mtb",
            }).onConflictDoNothing();
            // Fetch it back (in case of race condition)
            team = await db.query.teams.findFirst({
              where: ilike(teams.name, result.team),
            });
          }
          teamId = team?.id || null;

          // Update rider's current team if not set or different
          if (teamId && rider.teamId !== teamId) {
            await db
              .update(riders)
              .set({ teamId: teamId })
              .where(eq(riders.id, rider.id));
          }
        }

        // Insert result with team
        const timeMs = parseTime(result.time);
        await db.insert(raceResults).values({
          raceId: race.id,
          riderId: rider.id,
          teamId: teamId,
          position: result.position,
          timeSeconds: timeMs ? Math.round(timeMs / 1000) : null,
          dnf: result.dnf,
          dns: result.dns,
        });
      }

      createdRaces.push({
        id: race.id,
        name: raceName,
        category: catKey,
        resultsCount: categoryResults.length,
      });
    }

    return NextResponse.json({
      success: true,
      eventId: event.id,
      eventName: event.name,
      eventSlug: eventSlug,
      discipline: "mtb",
      races: createdRaces,
      totalRaces: createdRaces.length,
      totalResults: createdRaces.reduce((sum, r) => sum + r.resultsCount, 0),
    });
  } catch (error) {
    console.error("Error creating Copa Catalana event:", error);
    return NextResponse.json(
      { error: "Failed to create event", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
