import { NextResponse } from "next/server";
import { db, riders, riderDisciplineStats, teams } from "@/lib/db";
import { withRateLimit } from "@/lib/rate-limit";
import { validateQuery, searchRidersSchema } from "@/lib/validations";
import { eq, ilike, desc, and } from "drizzle-orm";

export async function GET(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "api");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);

  // Validate query parameters
  const { data, error } = validateQuery(searchParams, searchRidersSchema);
  if (error) return error;

  try {
    // Build where conditions
    const conditions = [];
    if (data.q) {
      conditions.push(ilike(riders.name, `%${data.q}%`));
    }
    if (data.discipline) {
      conditions.push(eq(riderDisciplineStats.discipline, data.discipline));
    }

    const results = await db
      .select({
        rider: riders,
        stats: riderDisciplineStats,
        team: teams,
      })
      .from(riders)
      .leftJoin(
        riderDisciplineStats,
        eq(riders.id, riderDisciplineStats.riderId)
      )
      .leftJoin(teams, eq(riderDisciplineStats.teamId, teams.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(riderDisciplineStats.currentElo))
      .limit(data.limit)
      .offset(data.offset);

    // Group by rider
    const riderMap = new Map<
      string,
      {
        id: string;
        name: string;
        nationality: string | null;
        photoUrl: string | null;
        team: string | null;
        stats: Array<{
          discipline: string;
          elo: number;
          wins: number;
          podiums: number;
          races: number;
        }>;
      }
    >();

    for (const row of results) {
      if (!riderMap.has(row.rider.id)) {
        riderMap.set(row.rider.id, {
          id: row.rider.id,
          name: row.rider.name,
          nationality: row.rider.nationality,
          photoUrl: row.rider.photoUrl,
          team: row.team?.name || null,
          stats: [],
        });
      }

      if (row.stats) {
        riderMap.get(row.rider.id)!.stats.push({
          discipline: row.stats.discipline,
          elo: parseFloat(row.stats.currentElo || "1500"),
          wins: row.stats.winsTotal || 0,
          podiums: row.stats.podiumsTotal || 0,
          races: row.stats.racesTotal || 0,
        });
      }
    }

    const riderList = Array.from(riderMap.values());

    return NextResponse.json({
      riders: riderList,
      pagination: {
        limit: data.limit,
        offset: data.offset,
        hasMore: results.length === data.limit,
      },
    });
  } catch (err) {
    console.error("Error fetching riders:", err);
    return NextResponse.json(
      { error: "Failed to fetch riders" },
      { status: 500 }
    );
  }
}
