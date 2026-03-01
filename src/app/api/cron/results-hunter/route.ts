import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  riders,
  raceResults,
  teams,
} from "@/lib/db";
import { and, ilike, eq, lt, lte, gte, asc, desc } from "drizzle-orm";
import { scrapeRaceResults } from "@/lib/scraper/pcs";
import {
  notifyRaceEventCombined,
  notifyRiderFollowers,
  getRaceEventId,
  getRaceEventInfo,
  type RaceSection,
} from "@/lib/notify-followers";

export const maxDuration = 60;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { console.warn("CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Rider lookup ──────────────────────────────────────────────────────────────

function normalizeRiderName(name: string): string {
  let normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  }
  return normalized
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function findOrCreateRider(name: string): Promise<string> {
  const normalizedName = normalizeRiderName(name);

  let rider = await db.query.riders.findFirst({
    where: ilike(riders.name, normalizedName),
  });

  if (!rider) {
    const strippedName = stripAccents(normalizedName);
    if (strippedName !== normalizedName) {
      rider = await db.query.riders.findFirst({
        where: ilike(riders.name, strippedName),
      });
    }
  }

  if (rider) return rider.id;

  const [newRider] = await db
    .insert(riders)
    .values({ name: normalizedName })
    .returning();

  return newRider.id;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ race: string; status: string; count?: number }> = [];

  try {
    // Find active races with dates in the past that still have no results
    const today = new Date().toISOString().split("T")[0];
    // Only look at races in the last 14 days, newest first
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const racesWithoutResults = await db
      .select()
      .from(races)
      .where(
        and(
          lte(races.date, today),
          gte(races.date, cutoff),
          eq(races.status, "active")
        )
      )
      .orderBy(desc(races.date))
      .limit(20); // Fetch more since many will be skipped (no pcs_url)

    for (const race of racesWithoutResults) {
      if (!race.pcsUrl) {
        results.push({ race: race.name, status: "skipped_no_pcs_url" });
        continue;
      }

      try {
        const resultUrl = race.pcsUrl.endsWith("/result") ? race.pcsUrl : `${race.pcsUrl}/result`;
        const scrapedResults = await scrapeRaceResults(resultUrl);

        if (scrapedResults.length === 0) {
          results.push({ race: race.name, status: "no_results_found" });
          continue;
        }

        let insertedCount = 0;
        for (const result of scrapedResults) {
          // Find rider in database
          const [rider] = await db
            .select()
            .from(riders)
            .where(eq(riders.pcsId, result.riderPcsId))
            .limit(1);

          if (!rider) continue;

          // Check if result already exists
          const [existing] = await db
            .select({ id: raceResults.id })
            .from(raceResults)
            .where(
              and(eq(raceResults.raceId, race.id), eq(raceResults.riderId, rider.id))
            )
            .limit(1);

          if (existing) continue;

          await db
            .insert(raceResults)
            .values({
              raceId: race.id,
              riderId: rider.id,
              position: result.position,
              dnf: result.dnf,
              dns: result.dns,
              pointsUci: result.uciPoints,
              pointsPcs: result.pcsPoints,
            })
            .onConflictDoNothing();

          insertedCount++;
        }

        // Only mark completed if we actually inserted results
        if (insertedCount > 0) {
          await db
            .update(races)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(races.id, race.id));
        }

        results.push({
          race: race.name,
          status: "success",
          count: insertedCount,
        });

        // Notify followers about results
        try {
          const raceEventId = await getRaceEventId(race.id);
          if (raceEventId) {
            const eventInfo = await getRaceEventInfo(raceEventId);
            if (eventInfo) {
              const top3 = await db
                .select({ name: riders.name, riderId: raceResults.riderId, position: raceResults.position })
                .from(raceResults)
                .innerJoin(riders, eq(raceResults.riderId, riders.id))
                .where(eq(raceResults.raceId, race.id))
                .orderBy(asc(raceResults.position))
                .limit(3);

              if (top3.length > 0) {
                const raceUrl = eventInfo.slug
                  ? `https://procyclingpredictor.com/races/${eventInfo.discipline}/${eventInfo.slug}`
                  : `https://procyclingpredictor.com`;

                const podiumLines = top3
                  .map((r, i) => `${["🥇", "🥈", "🥉"][i]} ${r.name}`)
                  .join("\n");

                const raceGender = race.gender;
                const genderLabel = raceGender === "women" ? "👩 Elite Women" : "👨 Elite Men";
                const section: RaceSection = {
                  raceId: race.id,
                  categoryLabel: genderLabel,
                  tgSection: podiumLines,
                  waSection: podiumLines.replace(/<[^>]+>/g, ""),
                };

                await notifyRaceEventCombined(
                  raceEventId,
                  [section],
                  `🏆 <b>Results are in for ${eventInfo.name}!</b>`,
                  `🏆 Results are in for ${eventInfo.name}!`,
                  `👉 <a href="${raceUrl}">Full results on Pro Cycling Predictor</a>`,
                  `👉 ${raceUrl}`,
                  `result`
                );

                // Notify individual top-3 rider followers
                for (const rider of top3) {
                  const positions = ["won", "finished 2nd in", "finished 3rd in"];
                  const riderMsg = [
                    `🚴 <b>${rider.name} ${positions[rider.position! - 1] ?? `finished P${rider.position} in`} ${eventInfo.name}!</b>`,
                    ``,
                    `👉 <a href="${raceUrl}">See full results on Pro Cycling Predictor</a>`,
                  ].join("\n");
                  await notifyRiderFollowers(rider.riderId, riderMsg);
                }
              }
            }
          }
        } catch (notifyErr) {
          console.error(`[results-hunter] Notification error for ${race.name}:`, notifyErr);
        }
      } catch (error) {
        console.error(`[results-hunter] Error processing ${race.name}:`, error);
        results.push({ race: race.name, status: "error" });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("[cron/results-hunter]", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
