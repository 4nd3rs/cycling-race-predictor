import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  db, races, raceEvents, raceStartlist, riderDisciplineStats, predictions,
  riders, riderRumours, raceNews, raceResults, teams
} from "@/lib/db";
import { and, eq, gte, lte, desc, sql, ne, inArray } from "drizzle-orm";
import { calculateElo, calculateAllProbabilities, type RiderSkill } from "@/lib/prediction/trueskill";
import { calculateForm, formMultiplier, RACE_CATEGORY_WEIGHTS, type RecentResult } from "@/lib/prediction/form";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { neon } from "@neondatabase/serverless";

export const maxDuration = 300;

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const DISCORD_CHANNEL = "1476643255243509912";
const MIN_STARTLIST = 3;
const STALE_HOURS = 6; // Regenerate if predictions are older than this

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyCronAuth(): Promise<boolean> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (process.env.NODE_ENV === "development") return true;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Discord ───────────────────────────────────────────────────────────────────

async function postToDiscord(message: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function matchRiderName(aiName: string, riderNames: Map<string, string>): string | null {
  const nameWords = norm(aiName).split(" ").filter(w => w.length > 2);
  for (const [riderId, rName] of riderNames) {
    const rWords = norm(rName).split(" ");
    const overlap = nameWords.filter(w => rWords.includes(w)).length;
    if (overlap >= 2 || (overlap >= 1 && nameWords.length === 1)) return riderId;
  }
  return null;
}

// ── News-based adjustments via Gemini ────────────────────────────────────────

async function getNewsAdjustments(
  raceEventId: string | null | undefined,
  riderNames: Map<string, string>
): Promise<Map<string, number>> {
  const adjustments = new Map<string, number>();
  if (!raceEventId || riderNames.size === 0) return adjustments;

  try {
    const articles = await db
      .select({ title: raceNews.title, content: raceNews.content, source: raceNews.source })
      .from(raceNews)
      .where(eq(raceNews.raceEventId, raceEventId))
      .orderBy(desc(raceNews.publishedAt))
      .limit(8);

    if (articles.length === 0) return adjustments;

    const context = articles.map(a =>
      a.content && a.content.length > 200
        ? `[${a.source}] ${a.title}\n${a.content.substring(0, 800)}`
        : `[${a.source}] ${a.title}`
    ).join("\n\n");

    const riderList = [...riderNames.values()].slice(0, 50).join(", ");
    const prompt = `From these cycling news articles, identify riders who are clear favorites (tier1), strong contenders (tier2), dark horses (tier3), or have injuries/withdrawals.

Articles:
${context}

Riders in startlist: ${riderList}

Return ONLY valid JSON: {"tier1":["name"],"tier2":["name"],"tier3":["name"],"injuries":["name"],"withdrawals":["name"]}
Use exact names from the startlist only.`;

    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return adjustments;

    const intel = JSON.parse(jsonMatch[0]) as Record<string, string[]>;
    const MULTIPLIERS: Record<string, number> = { tier1: 1.4, tier2: 1.2, tier3: 1.1, injuries: 0.05, withdrawals: 0.05 };

    for (const [tier, multiplier] of Object.entries(MULTIPLIERS)) {
      for (const name of (intel[tier] ?? [])) {
        const riderId = matchRiderName(name, riderNames);
        if (riderId && !adjustments.has(riderId)) adjustments.set(riderId, multiplier);
      }
    }
  } catch (err) {
    console.error("[predictions] News adjustments failed:", err);
  }

  return adjustments;
}

// ── AI win probabilities via Gemini ──────────────────────────────────────────

async function getAIProbabilities(
  raceName: string,
  raceDate: string,
  discipline: string,
  gender: string,
  riderNames: Map<string, string>,
  raceEventId?: string | null
): Promise<Map<string, number>> {
  const probMap = new Map<string, number>();
  if (discipline !== "road" || riderNames.size < 15) return probMap;

  try {
    // Previous edition analysis
    let previousAnalysis: string | null = null;
    if (raceEventId) {
      const sqlClient = neon(process.env.DATABASE_URL!);
      const rows = await sqlClient.query(`
        SELECT r.post_race_analysis FROM races r
        JOIN race_events re2 ON re2.id = r.race_event_id
        JOIN race_events re_cur ON re_cur.id = $1
        WHERE re2.name = re_cur.name AND r.gender = $2
          AND r.race_event_id != $1 AND r.post_race_analysis IS NOT NULL
          AND r.status = 'completed'
        ORDER BY r.date DESC LIMIT 1`, [raceEventId, gender]) as Array<{ post_race_analysis: string | null }>;
      previousAnalysis = rows[0]?.post_race_analysis ?? null;
    }

    const genderLabel = gender === "women" ? "Women's" : "Men's";
    const riderList = [...riderNames.values()].join("\n");
    const analysisSection = previousAnalysis ? `\nLessons from our previous prediction for this race:\n${previousAnalysis}\n` : "";

    const prompt = `You are an expert professional cycling analyst with deep knowledge of riders, race profiles, and results up to early 2026.${analysisSection}

Race: ${raceName}
Date: ${raceDate}
Category: ${genderLabel} Elite Road Race

Startlist:
${riderList}

Assign realistic win probability percentages to the top 15 most likely winners. Sum = 100. All others = 0%.
Guidelines: Even the strongest favorite rarely exceeds 35-40%. Spread probability realistically.
Use EXACT names from the startlist.

Return ONLY valid JSON: {"ExactName": percentage, ...}`;

    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return probMap;

    const raw = JSON.parse(jsonMatch[0]) as Record<string, number>;
    for (const [aiName, pct] of Object.entries(raw)) {
      if (typeof pct !== "number" || pct <= 0) continue;
      const riderId = matchRiderName(aiName, riderNames);
      if (riderId) probMap.set(riderId, pct / 100);
    }
  } catch (err) {
    console.error("[predictions] AI probabilities failed:", err);
  }

  return probMap;
}

// ── AI Preview generation ────────────────────────────────────────────────────

async function generateAIPreview(raceId: string): Promise<void> {
  const race = await db.query.races.findFirst({
    where: eq(races.id, raceId),
  });
  if (!race) return;

  // Skip if preview was generated recently (within 12h)
  if (race.aiPreviewGeneratedAt && new Date(race.aiPreviewGeneratedAt) > new Date(Date.now() - 12 * 3600000)) return;

  // For stages, get parent race to find the event
  const parentRace = race.parentRaceId
    ? await db.query.races.findFirst({ where: eq(races.id, race.parentRaceId) })
    : null;
  const raceEventId = race.raceEventId ?? parentRace?.raceEventId;
  const event = raceEventId
    ? await db.query.raceEvents.findFirst({ where: eq(raceEvents.id, raceEventId) })
    : null;

  // For stages, use parent's predictions/startlist
  const predRaceId = race.parentRaceId ?? raceId;
  const startlistRaceId = race.parentRaceId ?? raceId;

  // Get top predictions
  const topPreds = await db
    .select({ name: riders.name, team: teams.name, winProbability: predictions.winProbability })
    .from(predictions)
    .leftJoin(riders, eq(predictions.riderId, riders.id))
    .leftJoin(raceStartlist, and(eq(raceStartlist.raceId, startlistRaceId), eq(raceStartlist.riderId, predictions.riderId)))
    .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
    .where(eq(predictions.raceId, predRaceId))
    .orderBy(desc(predictions.winProbability))
    .limit(10);

  if (topPreds.length < 3) return;

  // Get news context (use parent's event for stages)
  const eventId = event?.id ?? race.raceEventId;
  const news = eventId
    ? await db
        .select({ title: raceNews.title, content: raceNews.content })
        .from(raceNews)
        .where(eq(raceNews.raceEventId, eventId))
        .orderBy(desc(raceNews.publishedAt))
        .limit(5)
    : [];

  // Get relevant rumours for riders on the startlist
  const rumours = await db
    .select({ riderName: riders.name, summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .innerJoin(raceStartlist, and(eq(raceStartlist.raceId, startlistRaceId), eq(raceStartlist.riderId, riderRumours.riderId)))
    .limit(5);

  const raceName = event?.name ?? race.name;
  const genderLabel = race.gender === "women" ? "Women's" : "Men's";
  const isStage = race.stageNumber !== null;
  const stageLabel = isStage ? ` - Stage ${race.stageNumber}` : "";

  const favourites = topPreds.slice(0, 5).map((p, i) =>
    `${i + 1}. ${p.name} (${p.team ?? "Unknown"}) — ${(parseFloat(p.winProbability ?? "0") * 100).toFixed(1)}% win probability`
  ).join("\n");

  const newsContext = news.length > 0
    ? news.map(n => `- ${n.title}${n.content ? `: ${n.content.substring(0, 200)}` : ""}`).join("\n")
    : "No recent news available";

  const rumourContext = rumours.length > 0
    ? rumours.map(r => `- ${r.riderName}: ${r.summary}`).join("\n")
    : "No rider intel available";

  const profileInfo = [
    race.profileType && `Profile: ${race.profileType}`,
    race.distanceKm && `Distance: ${parseFloat(String(race.distanceKm)).toFixed(0)} km`,
    race.elevationM && `Elevation: ${race.elevationM}m`,
    race.uciCategory && `Category: ${race.uciCategory}`,
  ].filter(Boolean).join(", ");

  const prompt = `You are Pro Cycling Predictor's AI analyst. Write a concise, insightful race preview for display on the race page.

Race: ${raceName}${stageLabel}
Date: ${race.date}
Category: ${genderLabel} Elite
${profileInfo ? `Course: ${profileInfo}` : ""}

Our model's top favourites:
${favourites}

Recent news:
${newsContext}

Rider intel:
${rumourContext}

Write a 3-4 paragraph preview (150-250 words total) that:
1. Opens with what makes this race/stage interesting and what the key storyline is
2. Discusses the top 2-3 favourites and why they're strong picks (form, terrain suitability, team strength)
3. Mentions a dark horse or surprise contender if relevant
4. Briefly notes any key absences, injuries, or conditions that could affect the outcome

Style: Knowledgeable cycling analysis. Confident but balanced. No hype language, no hashtags, no emojis.
Write in plain text (no markdown formatting, no bold, no headers).
Do NOT start with the race name — the reader already sees it on the page.`;

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const text = response.response.text()?.trim();
    if (!text || text.length < 100) return;

    await db.update(races).set({
      aiPreview: text,
      aiPreviewGeneratedAt: new Date(),
    }).where(eq(races.id, raceId));
  } catch (err) {
    console.error(`[predictions] AI preview generation failed for ${raceId}:`, err);
  }
}

// ── Core prediction generator ─────────────────────────────────────────────────

async function generateForRace(raceId: string): Promise<{ name: string; count: number } | null> {
  const race = await db.query.races.findFirst({ where: eq(races.id, raceId) });
  if (!race) return null;

  const { discipline } = race;
  const ageCategory = race.ageCategory ?? "elite";
  const gender = race.gender ?? "men";

  const startlistEntries = await db.query.raceStartlist.findMany({
    where: eq(raceStartlist.raceId, raceId),
    with: { rider: true },
  });

  if (startlistEntries.length < MIN_STARTLIST) return null;

  const skillsMap = new Map<string, RiderSkill>();
  const riderMeta = new Map<string, { name: string; racesTotal: number; uciPoints: number; rumourModifier: number; formScoreValue: number }>();

  // Pre-fetch recent results for all startlist riders (last 90 days) for form calculation
  const riderIds = startlistEntries.map(e => e.rider?.id).filter(Boolean) as string[];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const recentResults = riderIds.length > 0
    ? await db
        .select({
          riderId: raceResults.riderId,
          position: raceResults.position,
          dnf: raceResults.dnf,
          raceId: raceResults.raceId,
          raceDate: races.date,
          uciCategory: races.uciCategory,
          profileType: races.profileType,
        })
        .from(raceResults)
        .innerJoin(races, eq(raceResults.raceId, races.id))
        .where(and(
          inArray(raceResults.riderId, riderIds),
          gte(races.date, ninetyDaysAgo),
        ))
    : [];

  // Get field sizes (count of results per race) for form calculation
  const fieldSizes = new Map<string, number>();
  if (recentResults.length > 0) {
    const fieldSizeRows = await db
      .select({ raceId: raceResults.raceId, count: sql<number>`count(*)::int` })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .where(gte(races.date, ninetyDaysAgo))
      .groupBy(raceResults.raceId);
    for (const row of fieldSizeRows) {
      fieldSizes.set(row.raceId, row.count);
    }
  }

  // Group results by rider
  const resultsByRider = new Map<string, typeof recentResults>();
  for (const r of recentResults) {
    const existing = resultsByRider.get(r.riderId) ?? [];
    existing.push(r);
    resultsByRider.set(r.riderId, existing);
  }

  for (const entry of startlistEntries) {
    const rider = entry.rider;
    if (!rider) continue;

    let stats = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(riderDisciplineStats.riderId, rider.id),
        eq(riderDisciplineStats.discipline, discipline),
        eq(riderDisciplineStats.ageCategory, ageCategory),
      ),
    });

    if (!stats) {
      await db.insert(riderDisciplineStats).values({
        riderId: rider.id, discipline, ageCategory, gender,
        eloMean: "1500", eloVariance: "500", racesTotal: 0, uciPoints: 0,
      }).onConflictDoNothing();
      stats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(riderDisciplineStats.riderId, rider.id),
          eq(riderDisciplineStats.discipline, discipline),
          eq(riderDisciplineStats.ageCategory, ageCategory),
        ),
      });
    }

    const racesTotal = stats?.racesTotal ?? 0;
    const uciPoints = stats?.uciPoints ?? 0;

    let skill: RiderSkill;
    if (racesTotal === 0) {
      const uciBoost = uciPoints > 0 ? Math.min(Math.log(1 + uciPoints) * 30, 390) : 0;
      skill = { riderId: rider.id, mean: 300 + uciBoost, variance: 100 * 100 };
    } else {
      skill = {
        riderId: rider.id,
        mean: parseFloat(stats?.eloMean ?? "1500"),
        variance: parseFloat(stats?.eloVariance ?? "350") ** 2,
      };
    }

    // Form calculation from recent results
    const riderResults = resultsByRider.get(rider.id) ?? [];
    const formInput: RecentResult[] = riderResults.map(r => ({
      date: new Date(r.raceDate),
      position: r.position,
      fieldSize: fieldSizes.get(r.raceId) ?? 100,
      raceWeight: RACE_CATEGORY_WEIGHTS[r.uciCategory ?? ""] ?? RACE_CATEGORY_WEIGHTS.default,
      profileType: r.profileType ?? "hilly",
      dnf: r.dnf ?? false,
    }));
    const formScore = calculateForm(formInput);
    const formMult = formMultiplier(formScore.overall);

    // Apply form multiplier to skill mean
    skill = { ...skill, mean: skill.mean * formMult };

    // Rumour adjustment
    const rumour = await db.query.riderRumours.findFirst({
      where: and(eq(riderRumours.riderId, rider.id), eq(riderRumours.raceId, raceId)),
    });
    const generalRumour = !rumour
      ? await db.query.riderRumours.findFirst({ where: eq(riderRumours.riderId, rider.id) })
      : null;
    const sentiment = parseFloat((rumour ?? generalRumour)?.aggregateScore ?? "0");
    if (sentiment !== 0) skill = { ...skill, mean: skill.mean * (1 + sentiment * 0.05) };

    skillsMap.set(rider.id, skill);
    riderMeta.set(rider.id, { name: rider.name, racesTotal, uciPoints, rumourModifier: sentiment * 0.05, formScoreValue: formScore.overall });
  }

  const riderNamesMap = new Map([...riderMeta.entries()].map(([id, m]) => [id, m.name]));

  // News adjustments
  const newsAdj = await getNewsAdjustments(race.raceEventId, riderNamesMap);
  for (const [riderId, multiplier] of newsAdj) {
    const skill = skillsMap.get(riderId);
    if (skill) skillsMap.set(riderId, { ...skill, mean: skill.mean * multiplier });
  }

  // AI win probabilities (road only)
  const aiProbs = await getAIProbabilities(race.name, race.date, discipline, race.gender ?? "men", riderNamesMap, race.raceEventId);

  // ELO probabilities
  const eloProbs = calculateAllProbabilities(skillsMap);

  // Blend
  const aiWeight = aiProbs.size > 0 && discipline === "road" ? 0.7 : 0.0;
  const eloWeight = 1 - aiWeight;

  const ranked = Array.from(skillsMap.entries())
    .map(([riderId, skill]) => {
      const elo = eloProbs.get(riderId) ?? { win: 0, podium: 0, top10: 0 };
      const aiWin = aiProbs.get(riderId) ?? 0;
      const winProb = aiWeight * aiWin + eloWeight * elo.win;
      return { riderId, skill, winProb, podiumProb: elo.podium, top10Prob: elo.top10, meta: riderMeta.get(riderId)! };
    })
    .sort((a, b) => aiWeight > 0 ? b.winProb - a.winProb : calculateElo(b.skill.mean, b.skill.variance) - calculateElo(a.skill.mean, a.skill.variance));

  await db.delete(predictions).where(eq(predictions.raceId, raceId));

  const values = ranked.map((r, i) => ({
    raceId, riderId: r.riderId,
    predictedPosition: i + 1,
    winProbability: r.winProb.toFixed(4),
    podiumProbability: r.podiumProb.toFixed(4),
    top10Probability: r.top10Prob.toFixed(4),
    eloScore: calculateElo(r.skill.mean, r.skill.variance).toFixed(4),
    formScore: r.meta.formScoreValue.toFixed(4),
    rumourModifier: r.meta.rumourModifier.toFixed(4),
    confidenceScore: r.meta.racesTotal > 0
      ? r.meta.uciPoints > 0 ? "0.7000" : "0.5000"
      : r.meta.uciPoints > 0 ? "0.3000" : "0.1000",
    version: 1,
  }));

  for (let i = 0; i < values.length; i += 50) {
    await db.insert(predictions).values(values.slice(i, i + 50));
  }

  return { name: race.name, count: values.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!(await verifyCronAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") ?? "7");
  const raceId = searchParams.get("raceId");

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const staleThreshold = new Date(Date.now() - STALE_HOURS * 3600000);

  try {
    let racesToProcess: string[] = [];

    if (raceId) {
      racesToProcess = [raceId];
    } else {
      // Find upcoming races with startlists — skip if predictions are fresh
      const upcoming = await db
        .select({ id: races.id })
        .from(races)
        .where(and(
          eq(races.status, "active"),
          gte(races.date, today),
          lte(races.date, cutoff),
        ));

      for (const race of upcoming) {
        const startlistCount = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(raceStartlist)
          .where(eq(raceStartlist.raceId, race.id));

        if ((startlistCount[0]?.n ?? 0) < MIN_STARTLIST) continue;

        const latestPred = await db.query.predictions.findFirst({
          where: eq(predictions.raceId, race.id),
          orderBy: (p, { desc }) => [desc(p.createdAt)],
        });

        // Skip if predictions were generated recently
        if (latestPred?.createdAt && new Date(latestPred.createdAt) > staleThreshold) continue;

        racesToProcess.push(race.id);
      }
    }

    const results: string[] = [];
    let generated = 0;

    for (const id of racesToProcess) {
      try {
        const result = await generateForRace(id);
        if (result) {
          results.push(`${result.name} (${result.count})`);
          generated++;
          // Generate AI preview text after predictions
          await generateAIPreview(id).catch(e =>
            console.error(`[predictions] AI preview error for ${id}:`, e)
          );
          // Also generate previews for stages of this race
          const stageRows = await db
            .select({ id: races.id })
            .from(races)
            .where(and(eq(races.parentRaceId, id), gte(races.date, today)));
          for (const stage of stageRows) {
            await generateAIPreview(stage.id).catch(e =>
              console.error(`[predictions] AI preview error for stage ${stage.id}:`, e)
            );
          }
        }
      } catch (e) {
        console.error(`[predictions] Error for race ${id}:`, e);
      }
    }

    if (generated > 0) {
      const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
      await postToDiscord(`🔮 Predictions [${time}] — Generated for ${generated} race(s):\n${results.slice(0, 5).map(r => `• ${r}`).join("\n")}`);
    }

    return NextResponse.json({ success: true, generated, races: results, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/generate-predictions]", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  return GET(new Request("https://localhost/api/cron/generate-predictions"));
}
