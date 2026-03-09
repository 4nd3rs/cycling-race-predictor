import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db,
  races,
  riders,
  raceResults,
} from "@/lib/db";
import { and, ilike, eq, lte, gte, asc, desc, isNull, sql } from "drizzle-orm";
import { scrapeRaceResults, detectStageCount, scrapeStageMetadata } from "@/lib/scraper/pcs";
import {
  notifyRaceEventCombined,
  notifyRiderFollowers,
  getRaceEventId,
  getRaceEventInfo,
  type RaceSection,
} from "@/lib/notify-followers";

export const maxDuration = 300;

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStageRace(race: { raceType: string | null; endDate: string | null; date: string }): boolean {
  return race.raceType === "stage_race" || (race.endDate !== null && race.endDate !== race.date);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Import scraped results into a race record, returns count of inserted results */
async function importResults(
  raceId: string,
  scrapedResults: Awaited<ReturnType<typeof scrapeRaceResults>>
): Promise<number> {
  let insertedCount = 0;
  for (const result of scrapedResults) {
    // Find rider by pcsId first, then by name
    let riderId: string | null = null;
    if (result.riderPcsId) {
      const [rider] = await db
        .select({ id: riders.id })
        .from(riders)
        .where(eq(riders.pcsId, result.riderPcsId))
        .limit(1);
      if (rider) riderId = rider.id;
    }
    if (!riderId && result.riderName) {
      try {
        riderId = await findOrCreateRider(result.riderName);
      } catch { continue; }
    }
    if (!riderId) continue;

    // Check if result already exists
    const [existing] = await db
      .select({ id: raceResults.id })
      .from(raceResults)
      .where(and(eq(raceResults.raceId, raceId), eq(raceResults.riderId, riderId)))
      .limit(1);

    if (existing) continue;

    await db
      .insert(raceResults)
      .values({
        raceId,
        riderId,
        position: result.position,
        dnf: result.dnf,
        dns: result.dns,
        pointsUci: result.uciPoints,
        pointsPcs: result.pcsPoints,
      })
      .onConflictDoNothing();

    insertedCount++;
  }
  return insertedCount;
}

/** Ensure child stage records exist for a stage race */
async function ensureStageRecords(
  race: { id: string; name: string; date: string; endDate: string | null; discipline: string; ageCategory: string | null; gender: string | null; pcsUrl: string | null },
  stageCount: number,
): Promise<void> {
  if (!race.pcsUrl) return;
  const pcsUrl = race.pcsUrl;

  const existingStages = await db
    .select({ id: races.id, stageNumber: races.stageNumber, profileType: races.profileType, distanceKm: races.distanceKm })
    .from(races)
    .where(eq(races.parentRaceId, race.id));

  const existingNumbers = new Set(existingStages.map(s => s.stageNumber).filter(Boolean));
  const missingStages: number[] = [];
  for (let i = 1; i <= stageCount; i++) {
    if (!existingNumbers.has(i)) missingStages.push(i);
  }

  const metadata = await scrapeStageMetadata(pcsUrl, stageCount);

  // Enrich existing stages with profile/distance data from PCS
  for (const existing of existingStages) {
    const meta = metadata.find(m => m.stageNumber === existing.stageNumber);
    if (!meta) continue;
    const updates: Record<string, string | null> = {};
    if (meta.profileType && meta.profileType !== existing.profileType) updates.profileType = meta.profileType;
    if (meta.distanceKm && !existing.distanceKm) updates.distanceKm = meta.distanceKm;
    if (Object.keys(updates).length > 0) {
      await db.update(races).set(updates).where(eq(races.id, existing.id));
      console.log(`[results-hunter] Enriched stage ${existing.stageNumber} with ${Object.keys(updates).join(", ")}`);
    }
  }

  if (missingStages.length === 0) {
    console.log(`[results-hunter] All ${stageCount} stage records exist for ${race.name}`);
    return;
  }

  console.log(`[results-hunter] Creating ${missingStages.length} stage records for ${race.name}`);

  const startDate = new Date(race.date);
  const endDate = race.endDate ? new Date(race.endDate) : new Date(startDate.getTime() + stageCount * 86400000);
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));

  // Get parent race's raceEventId
  const [parentRow] = await db
    .select({ raceEventId: races.raceEventId, uciCategory: races.uciCategory, country: races.country })
    .from(races)
    .where(eq(races.id, race.id))
    .limit(1);

  for (const stageNum of missingStages) {
    const meta = metadata.find(m => m.stageNumber === stageNum);

    let stageDate: string;
    if (meta?.date) {
      stageDate = meta.date;
    } else {
      const dayOffset = Math.round(((stageNum - 1) / Math.max(1, stageCount - 1)) * totalDays);
      const d = new Date(startDate.getTime() + dayOffset * 86400000);
      stageDate = d.toISOString().split("T")[0];
    }

    const stageName = meta?.name || `Stage ${stageNum}`;

    await db.insert(races).values({
      name: `${race.name} - ${stageName}`,
      date: stageDate,
      discipline: race.discipline,
      raceType: "stage",
      profileType: meta?.profileType ?? null,
      ageCategory: race.ageCategory ?? "elite",
      gender: race.gender ?? "men",
      distanceKm: meta?.distanceKm ?? null,
      parentRaceId: race.id,
      stageNumber: stageNum,
      raceEventId: parentRow?.raceEventId ?? null,
      uciCategory: parentRow?.uciCategory ?? null,
      country: parentRow?.country ?? null,
      pcsUrl: `${pcsUrl}/stage-${stageNum}`,
      status: "active",
    });
  }

  console.log(`[results-hunter] Created ${missingStages.length} stage records`);
}

/** Send notifications for race results */
async function notifyResults(
  race: { id: string; name: string; gender: string | null },
  label?: string,
): Promise<void> {
  try {
    const raceEventId = await getRaceEventId(race.id);
    if (!raceEventId) return;
    const eventInfo = await getRaceEventInfo(raceEventId);
    if (!eventInfo) return;

    const top3 = await db
      .select({ name: riders.name, riderId: raceResults.riderId, position: raceResults.position })
      .from(raceResults)
      .innerJoin(riders, eq(raceResults.riderId, riders.id))
      .where(eq(raceResults.raceId, race.id))
      .orderBy(asc(raceResults.position))
      .limit(3);

    if (top3.length === 0) return;

    const raceUrl = eventInfo.slug
      ? `https://procyclingpredictor.com/races/${eventInfo.discipline}/${eventInfo.slug}`
      : `https://procyclingpredictor.com`;

    const podiumLines = top3
      .map((r, i) => `${["🥇", "🥈", "🥉"][i]} ${r.name}`)
      .join("\n");

    const displayName = label ?? eventInfo.name;
    const genderLabel = race.gender === "women" ? "👩 Elite Women" : "👨 Elite Men";
    const section: RaceSection = {
      raceId: race.id,
      categoryLabel: genderLabel,
      tgSection: podiumLines,
      waSection: podiumLines.replace(/<[^>]+>/g, ""),
    };

    await notifyRaceEventCombined(
      raceEventId,
      [section],
      `🏆 <b>Results are in for ${displayName}!</b>`,
      `🏆 Results are in for ${displayName}!`,
      `👉 <a href="${raceUrl}">Full results on Pro Cycling Predictor</a>`,
      `👉 ${raceUrl}`,
      `result`
    );

    for (const rider of top3) {
      const positions = ["won", "finished 2nd in", "finished 3rd in"];
      const riderMsg = [
        `🚴 <b>${rider.name} ${positions[rider.position! - 1] ?? `finished P${rider.position} in`} ${displayName}!</b>`,
        ``,
        `👉 <a href="${raceUrl}">See full results on Pro Cycling Predictor</a>`,
      ].join("\n");
      await notifyRiderFollowers(rider.riderId, riderMsg);
    }
  } catch (notifyErr) {
    console.error(`[results-hunter] Notification error for ${race.name}:`, notifyErr);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const startTime = Date.now();
  const isAuthorized = await verifyCronAuth();
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ race: string; status: string; count?: number }> = [];

  try {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Exclude child stage records (they have parentRaceId set)
    const notChildStage = isNull(races.parentRaceId);

    // Q1: races that started within the lookback window
    const q1 = await db
      .select()
      .from(races)
      .where(
        and(
          lte(races.date, today),
          gte(races.date, cutoff),
          eq(races.status, "active"),
          notChildStage
        )
      )
      .orderBy(desc(races.date))
      .limit(20);

    // Q2: stage races started before window but ending within it (ongoing tours)
    const q2 = await db
      .select()
      .from(races)
      .where(
        and(
          sql`(${races.raceType} = 'stage_race' OR ${races.endDate} IS NOT NULL)`,
          sql`${races.date} < ${cutoff}`,
          sql`${races.endDate} >= ${cutoff}`,
          sql`${races.endDate} <= ${tomorrow}`,
          eq(races.status, "active"),
          notChildStage
        )
      )
      .orderBy(desc(races.date))
      .limit(10);

    // Deduplicate
    const seen = new Set<string>();
    const racesToProcess = [...q1, ...q2].filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    for (const race of racesToProcess) {
      // Time safety: stop 30s before maxDuration
      if (Date.now() - startTime > (maxDuration - 30) * 1000) {
        console.log(`[results-hunter] Approaching timeout, stopping early`);
        break;
      }

      if (!race.pcsUrl) {
        results.push({ race: race.name, status: "skipped_no_pcs_url" });
        continue;
      }

      try {
        if (isStageRace(race)) {
          // ── Stage race handling ──────────────────────────────────────────
          const stageCount = await detectStageCount(race.pcsUrl);
          console.log(`[results-hunter] ${race.name}: ${stageCount} stages detected`);

          if (stageCount === 0) {
            // Fallback: try as one-day race
            const scrapedResults = await scrapeRaceResults(`${race.pcsUrl}/result`);
            if (scrapedResults.length > 0) {
              const count = await importResults(race.id, scrapedResults);
              if (count > 0) {
                await db.update(races).set({ status: "completed", updatedAt: new Date() }).where(eq(races.id, race.id));
                await notifyResults(race);
              }
              results.push({ race: race.name, status: "success", count });
            } else {
              results.push({ race: race.name, status: "no_stages_detected" });
            }
            continue;
          }

          // Create missing child stage records
          await ensureStageRecords(race, stageCount);

          // Get all child stage records
          const stageRecords = await db
            .select({ id: races.id, stageNumber: races.stageNumber, status: races.status, name: races.name })
            .from(races)
            .where(eq(races.parentRaceId, race.id))
            .orderBy(races.stageNumber);

          let totalStageInserts = 0;

          // Scrape per-stage results
          for (const stageRec of stageRecords) {
            if (Date.now() - startTime > (maxDuration - 30) * 1000) break;
            if (!stageRec.stageNumber) continue;
            if (stageRec.status === "completed") continue;

            const stageResults = await scrapeRaceResults(
              `${race.pcsUrl}/stage-${stageRec.stageNumber}/result`
            );

            if (stageResults.length >= 5) {
              const count = await importResults(stageRec.id, stageResults);
              totalStageInserts += count;
              if (count > 0) {
                await db.update(races)
                  .set({ status: "completed", updatedAt: new Date() })
                  .where(eq(races.id, stageRec.id));
                console.log(`[results-hunter] Stage ${stageRec.stageNumber}: ${count} results imported`);
              }
            }

            await sleep(1500);
          }

          // Check if race is finished — scrape GC
          const raceEnd = race.endDate ?? race.date;
          if (today >= raceEnd) {
            const gcResults = await scrapeRaceResults(`${race.pcsUrl}/gc`);
            if (gcResults.length > 0) {
              const gcCount = await importResults(race.id, gcResults);
              if (gcCount > 0) {
                await db.update(races)
                  .set({ status: "completed", updatedAt: new Date() })
                  .where(eq(races.id, race.id));
                await notifyResults(race);
                console.log(`[results-hunter] GC: ${gcCount} results imported`);
              }
            }
          }

          results.push({ race: race.name, status: "success", count: totalStageInserts });
        } else {
          // ── One-day race handling (unchanged) ──────────────────────────
          const resultUrl = race.pcsUrl.endsWith("/result") ? race.pcsUrl : `${race.pcsUrl}/result`;
          const scrapedResults = await scrapeRaceResults(resultUrl);

          if (scrapedResults.length === 0) {
            results.push({ race: race.name, status: "no_results_found" });
            continue;
          }

          const insertedCount = await importResults(race.id, scrapedResults);

          if (insertedCount > 0) {
            await db.update(races)
              .set({ status: "completed", updatedAt: new Date() })
              .where(eq(races.id, race.id));
          }

          results.push({ race: race.name, status: "success", count: insertedCount });

          if (insertedCount > 0) {
            await notifyResults(race);
          }
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
