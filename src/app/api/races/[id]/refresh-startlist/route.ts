import { NextResponse } from "next/server";
import { db, races, raceStartlist, riders, predictions, teams, raceEvents, riderDisciplineStats } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit";
import { scrapeRacePage } from "@/lib/scraper/pcs";
import { scrapeRockthesportEvent, mapCategory } from "@/lib/scraper/rockthesport";
import { normalizeRiderName } from "@/lib/scraper/startlist-parser";
import { eq, ilike, and } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  // Rate limit (stricter for scraping)
  const rateLimitResponse = await withRateLimit(request, "scrape");
  if (rateLimitResponse) return rateLimitResponse;

  // Require authentication
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    // Get the race
    const [race] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Get event info to determine source type
    let sourceType = "pcs";
    let sourceUrl = race.pcsUrl || race.startlistUrl;

    if (race.raceEventId) {
      const [event] = await db
        .select()
        .from(raceEvents)
        .where(eq(raceEvents.id, race.raceEventId))
        .limit(1);

      if (event?.sourceType) {
        sourceType = event.sourceType;
        sourceUrl = event.sourceUrl || sourceUrl;
      }
    }

    // Also check if startlistUrl looks like rockthesport
    if (sourceUrl?.includes("rockthesport.com")) {
      sourceType = "rockthesport";
    }

    if (!sourceUrl) {
      return NextResponse.json(
        { error: "No source URL available for this race" },
        { status: 400 }
      );
    }

    // Handle different source types
    if (sourceType === "rockthesport") {
      return await refreshFromRockthesport(id, race, sourceUrl);
    }

    // Only PCS and rockthesport support automatic scraping
    if (sourceType !== "pcs" && sourceType !== "procyclingstats") {
      return NextResponse.json(
        { error: `Source type "${sourceType}" does not support automatic startlist refresh. Use manual upload instead.` },
        { status: 400 }
      );
    }

    // Default: PCS
    const result = await scrapeRacePage(sourceUrl);

    if (!result || result.startlist.length === 0) {
      return NextResponse.json(
        { error: "Could not fetch startlist from PCS" },
        { status: 400 }
      );
    }

    // Track stats
    let newRiders = 0;
    let updatedRiders = 0;
    const processedRiderIds = new Set<string>();

    // Process each rider in the startlist
    for (const entry of result.startlist) {
      const normalizedName = normalizeRiderName(entry.riderName);

      // Try to find existing rider by PCS ID first
      let existingRider = null;
      if (entry.riderPcsId) {
        [existingRider] = await db
          .select()
          .from(riders)
          .where(eq(riders.pcsId, entry.riderPcsId))
          .limit(1);
      }

      // If not found, try by name
      if (!existingRider) {
        [existingRider] = await db
          .select()
          .from(riders)
          .where(ilike(riders.name, normalizedName))
          .limit(1);
      }

      // Create rider if not found
      if (!existingRider) {
        [existingRider] = await db
          .insert(riders)
          .values({
            name: normalizedName,
            pcsId: entry.riderPcsId || null,
          })
          .returning();
        newRiders++;
      } else {
        // Update PCS ID if we have it now
        if (entry.riderPcsId && !existingRider.pcsId) {
          await db
            .update(riders)
            .set({ pcsId: entry.riderPcsId })
            .where(eq(riders.id, existingRider.id));
        }
      }

      processedRiderIds.add(existingRider.id);

      // Find or create team
      let teamId: string | null = null;
      if (entry.teamName) {
        const [existingTeam] = await db
          .select()
          .from(teams)
          .where(ilike(teams.name, entry.teamName))
          .limit(1);

        if (existingTeam) {
          teamId = existingTeam.id;
        } else {
          const [newTeam] = await db
            .insert(teams)
            .values({
              name: entry.teamName,
              discipline: race.discipline,
            })
            .returning();
          teamId = newTeam.id;
        }
      }

      // Check if already in startlist
      const [existingEntry] = await db
        .select()
        .from(raceStartlist)
        .where(
          and(
            eq(raceStartlist.raceId, id),
            eq(raceStartlist.riderId, existingRider.id)
          )
        )
        .limit(1);

      if (!existingEntry) {
        // Add to startlist
        await db.insert(raceStartlist).values({
          raceId: id,
          riderId: existingRider.id,
          bibNumber: entry.bibNumber || null,
          teamId,
          status: "confirmed",
        });
        updatedRiders++;
      } else {
        // Update bib number and team if changed
        const updates: { bibNumber?: number; teamId?: string | null } = {};
        if (entry.bibNumber && existingEntry.bibNumber !== entry.bibNumber) {
          updates.bibNumber = entry.bibNumber;
        }
        if (teamId && existingEntry.teamId !== teamId) {
          updates.teamId = teamId;
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(raceStartlist)
            .set(updates)
            .where(eq(raceStartlist.id, existingEntry.id));
        }
      }
    }

    // Delete old predictions so they get regenerated
    await db.delete(predictions).where(eq(predictions.raceId, id));

    // Get final startlist count
    const startlistCount = await db
      .select({ id: raceStartlist.id })
      .from(raceStartlist)
      .where(eq(raceStartlist.raceId, id));

    return NextResponse.json({
      message: "Startlist updated",
      totalRiders: startlistCount.length,
      newRiders,
      addedToStartlist: updatedRiders,
    });
  } catch (error) {
    console.error("Error refreshing startlist:", error);
    return NextResponse.json(
      { error: "Failed to refresh startlist" },
      { status: 500 }
    );
  }
}

/**
 * Refresh startlists from Rockthesport for ALL races in the same event.
 * Scrapes once, then distributes entries across all category races.
 */
async function refreshFromRockthesport(
  raceId: string,
  race: typeof races.$inferSelect,
  sourceUrl: string
) {
  const scrapedEvent = await scrapeRockthesportEvent(sourceUrl);

  if (!scrapedEvent || scrapedEvent.entries.length === 0) {
    return NextResponse.json(
      { error: "Could not fetch startlist from Rockthesport" },
      { status: 400 }
    );
  }

  // Get all sibling races in the same event
  let eventRaces: (typeof races.$inferSelect)[];
  if (race.raceEventId) {
    eventRaces = await db
      .select()
      .from(races)
      .where(eq(races.raceEventId, race.raceEventId));
  } else {
    eventRaces = [race];
  }

  // Check if entries have categories
  const hasCategories = scrapedEvent.entries.some((e) => e.category);

  // Build a map of raceId -> { ageCategory, gender } for quick lookup
  const racesByCategory = new Map<string, typeof races.$inferSelect>();
  for (const r of eventRaces) {
    const key = `${r.ageCategory}_${r.gender}`;
    racesByCategory.set(key, r);
  }

  let newRiders = 0;
  let addedToStartlist = 0;
  let skippedNoCategory = 0;
  const updatedRaceIds = new Set<string>();

  for (const entry of scrapedEvent.entries) {
    const fullName = `${entry.firstName} ${entry.lastName}`.trim();
    const normalizedName = normalizeRiderName(fullName);
    if (!normalizedName) continue;

    // Find existing rider by name
    let [existingRider] = await db
      .select()
      .from(riders)
      .where(ilike(riders.name, normalizedName))
      .limit(1);

    // Determine which race(s) this entry belongs to
    let targetRaces: (typeof races.$inferSelect)[] = [];

    if (hasCategories) {
      const mapped = mapCategory(entry.category || "");
      if (!mapped) continue; // unsupported category (cadete, master, etc.)
      const key = `${mapped.ageCategory}_${mapped.gender}`;
      const targetRace = racesByCategory.get(key);
      if (targetRace) targetRaces = [targetRace];
    } else {
      // No categories on source - match against UCI rankings
      if (!existingRider) {
        skippedNoCategory++;
        continue;
      }

      // Find all matching discipline stats for this rider
      const statsRows = await db
        .select()
        .from(riderDisciplineStats)
        .where(
          and(
            eq(riderDisciplineStats.riderId, existingRider.id),
            eq(riderDisciplineStats.discipline, race.discipline)
          )
        );

      if (statsRows.length === 0) {
        skippedNoCategory++;
        continue;
      }

      // Add to each matching race (match both ageCategory and gender)
      for (const stat of statsRows) {
        for (const [, r] of racesByCategory) {
          if (r.ageCategory === stat.ageCategory && r.gender === (stat.gender || "men")) {
            targetRaces.push(r);
          }
        }
      }

      if (targetRaces.length === 0) {
        skippedNoCategory++;
        continue;
      }
    }

    // Create rider if not found
    if (!existingRider) {
      [existingRider] = await db
        .insert(riders)
        .values({
          name: normalizedName,
          nationality: entry.nationality || null,
        })
        .returning();
      newRiders++;
    } else if (entry.nationality && !existingRider.nationality) {
      await db
        .update(riders)
        .set({ nationality: entry.nationality })
        .where(eq(riders.id, existingRider.id));
    }

    // Find or create team
    let teamId: string | null = null;
    const teamName = entry.teamName || entry.clubName;
    if (teamName) {
      let [existingTeam] = await db
        .select()
        .from(teams)
        .where(ilike(teams.name, teamName))
        .limit(1);

      if (!existingTeam) {
        [existingTeam] = await db
          .insert(teams)
          .values({
            name: teamName,
            discipline: race.discipline,
          })
          .returning();
      }
      teamId = existingTeam.id;
    }

    // Add to each target race's startlist
    for (const targetRace of targetRaces) {
      const [existingEntry] = await db
        .select()
        .from(raceStartlist)
        .where(
          and(
            eq(raceStartlist.raceId, targetRace.id),
            eq(raceStartlist.riderId, existingRider.id)
          )
        )
        .limit(1);

      if (!existingEntry) {
        await db.insert(raceStartlist).values({
          raceId: targetRace.id,
          riderId: existingRider.id,
          bibNumber: entry.bibNumber || null,
          teamId,
          status: "confirmed",
        });
        addedToStartlist++;
      } else {
        const updates: { bibNumber?: number | null; teamId?: string | null } = {};
        if (entry.bibNumber && existingEntry.bibNumber !== entry.bibNumber) {
          updates.bibNumber = entry.bibNumber;
        }
        if (teamId && existingEntry.teamId !== teamId) {
          updates.teamId = teamId;
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(raceStartlist)
            .set(updates)
            .where(eq(raceStartlist.id, existingEntry.id));
        }
      }

      // Ensure rider has riderDisciplineStats for this race's discipline + ageCategory
      const [existingStats] = await db
        .select()
        .from(riderDisciplineStats)
        .where(
          and(
            eq(riderDisciplineStats.riderId, existingRider.id),
            eq(riderDisciplineStats.discipline, targetRace.discipline),
            eq(riderDisciplineStats.ageCategory, targetRace.ageCategory || "elite")
          )
        )
        .limit(1);

      if (!existingStats) {
        await db.insert(riderDisciplineStats).values({
          riderId: existingRider.id,
          discipline: targetRace.discipline,
          ageCategory: targetRace.ageCategory || "elite",
          gender: targetRace.gender || "men",
          teamId,
        });
      }

      updatedRaceIds.add(targetRace.id);
    }
  }

  // Delete old predictions for all updated races so they get regenerated
  for (const updatedRaceId of updatedRaceIds) {
    await db.delete(predictions).where(eq(predictions.raceId, updatedRaceId));
  }

  // Get per-race startlist counts
  const raceSummaries: Array<{ name: string; riders: number }> = [];
  for (const r of eventRaces) {
    const count = await db
      .select({ id: raceStartlist.id })
      .from(raceStartlist)
      .where(eq(raceStartlist.raceId, r.id));
    raceSummaries.push({ name: r.name, riders: count.length });
  }

  const response: Record<string, unknown> = {
    message: hasCategories
      ? "Startlists updated from Rockthesport"
      : "Startlists updated from Rockthesport (matched against UCI rankings - categories not yet assigned on source)",
    racesUpdated: updatedRaceIds.size,
    races: raceSummaries,
    newRiders,
    addedToStartlist,
  };

  if (!hasCategories) {
    response.skippedUnknownCategory = skippedNoCategory;
  }

  return NextResponse.json(response);
}
