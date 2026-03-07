/**
 * Generate Predictions Agent
 *
 * Uses the TrueSkill-based rating system (μ - 3σ conservative estimate) to
 * generate race predictions. Riders with no race history are ranked below all
 * rated riders; UCI points provide a weak bootstrap signal within that band.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/agents/generate-predictions.ts --race-id <uuid>
 *   node_modules/.bin/tsx scripts/agents/generate-predictions.ts --days 3
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import {
  calculateElo,
  calculateAllProbabilities,
  type RiderSkill,
} from "../../src/lib/prediction/trueskill";
import { notifyRaceEventFollowers } from "./lib/notify-followers";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Use race news headlines to generate per-rider mean adjustments.
 * Returns a map of riderId → multiplier (e.g. 1.12 = +12% to mean, 0.88 = -12%).
 * Structured tiers: tier1 (top favorite) → ×2.5, tier2 (podium contender) → ×1.6,
 * tier3 (outsider) → ×1.2, injury/withdrawal → ×0.05 (effectively removes them).
 * Uses article content when available, falls back to titles only.
 */
async function getNewsBasedAdjustments(
  raceEventId: string | null | undefined,
  riderNames: Map<string, string>
): Promise<Map<string, number>> {
  const adjustments = new Map<string, number>();
  if (!raceEventId || riderNames.size === 0) return adjustments;

  const articles: Array<{title: string; source: string; content: string | null}> = await sql`
    SELECT title, source, content FROM race_news
    WHERE race_event_id = ${raceEventId}
    ORDER BY
      CASE WHEN content IS NOT NULL AND length(content) > 200 THEN 0 ELSE 1 END,
      published_at DESC
    LIMIT 8
  `;
  if (articles.length === 0) return adjustments;

  // Build context: prefer articles with actual content
  const contentArticles = articles.filter(a => a.content && a.content.length > 200);
  const headlineOnly = articles.filter(a => !a.content || a.content.length <= 200);

  let context = "";
  if (contentArticles.length > 0) {
    context += "ARTICLE CONTENT:\n";
    for (const a of contentArticles.slice(0, 3)) {
      context += `\n--- ${a.title} (${a.source}) ---\n${a.content!.substring(0, 1500)}\n`;
    }
  }
  if (headlineOnly.length > 0) {
    context += "\nHEADLINES ONLY:\n";
    context += headlineOnly.map(a => "- " + a.title + " (" + a.source + ")").join("\n");
  }

  // Normalize names to proper case so the AI recognizes well-known riders
  function normalizeForAI(name: string): string {
    const words = name.split(" ");
    if (words.length >= 2 && words[0] === words[0].toUpperCase() && /^[A-ZÀ-Ö]+$/.test(words[0])) {
      return `${words.slice(1).join(" ")} ${words[0].charAt(0) + words[0].slice(1).toLowerCase()}`;
    }
    return name;
  }
  // Include all riders (normalized to proper case) so the AI can identify any of them
  const riderList = [...riderNames.values()].map(normalizeForAI).join(", ");

  const prompt = `You are a cycling expert analyzing pre-race intelligence to predict rider performance.

${context}

STARTLIST (use EXACT names from this list):
${riderList}

Extract rider predictions and return ONLY valid JSON in this exact format:
{
  "tier1": ["Name1", "Name2"],
  "tier2": ["Name3", "Name4", "Name5"],
  "tier3": ["Name6", "Name7"],
  "injuries": ["Name8"],
  "withdrawals": ["Name9"]
}

Rules:
- tier1 = top favorites/pre-race picks to win (1-3 riders max)
- tier2 = podium contenders (2-6 riders)
- tier3 = dark horses/outsiders with a chance (up to 10 riders)
- injuries = riders confirmed injured/sick
- withdrawals = riders confirmed withdrawn/DNS
- Match names by surname overlap. Use exact names from the startlist.
- If no clear signal exists for a tier, use empty array [].
- Return ONLY the JSON object, no other text.`;

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return adjustments;

    interface NewsIntel {
      tier1?: string[];
      tier2?: string[];
      tier3?: string[];
      injuries?: string[];
      withdrawals?: string[];
    }
    const intel = JSON.parse(jsonMatch[0]) as NewsIntel;

    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim().toLowerCase();

    // Build normalized lookup: riderId → set of name words, and a "surname-priority" token
    // PCS format is "LASTNAME Firstname"; normalize both to catch all formats
    function normalizeRiderName(raw: string): string[] {
      const n = norm(raw);
      // If all-caps first word (PCS format "LASTNAME Firstname"), swap to "firstname lastname"
      const words = raw.split(" ");
      const swapped = words[0] === words[0].toUpperCase() && words[0].length > 2
        ? [words.slice(1).join(" "), words[0]].join(" ") : raw;
      return [...new Set([...norm(n).split(" "), ...norm(swapped).split(" ")])].filter(w => w.length > 2);
    }

    function findRider(name: string): string | null {
      const nameWords = norm(name).split(" ").filter(w => w.length > 2);
      if (nameWords.length === 0) return null;

      let bestMatch: string | null = null;
      let bestScore = 0;

      for (const [riderId, rName] of riderNames) {
        const rWords = normalizeRiderName(rName);
        const overlap = nameWords.filter(w => rWords.includes(w)).length;
        // Require at least 2 word overlap OR exact surname match (longest word >= 5 chars)
        const hasLongWordMatch = nameWords.some(w => w.length >= 5 && rWords.includes(w));
        if (overlap >= 2 || (overlap >= 1 && hasLongWordMatch)) {
          // Prefer matches with more overlap and longer matched words
          const score = overlap * 10 + nameWords.filter(w => w.length >= 5 && rWords.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestMatch = riderId; }
        }
      }
      return bestMatch;
    }

    // Strong news multipliers — news/expert consensus should dominate ELO for big races.
    // tier1 (clear favourite): ×4.0 — puts them well ahead regardless of ELO
    // tier2 (podium contender): ×2.5 — solid boost
    // tier3 (outsider/dark horse): ×1.5
    // injuries/withdrawals: ×0.05 — effectively removes them
    const MULTIPLIERS = { tier1: 4.0, tier2: 2.5, tier3: 1.5, injuries: 0.05, withdrawals: 0.05 };

    for (const [tier, multiplier] of Object.entries(MULTIPLIERS) as [keyof typeof MULTIPLIERS, number][]) {
      for (const name of (intel[tier] || [])) {
        const riderId = findRider(name);
        if (riderId && !adjustments.has(riderId)) {
          adjustments.set(riderId, multiplier);
        }
      }
    }

    if (adjustments.size > 0) {
      const summary = [...adjustments.entries()]
        .map(([id, m]) => `${riderNames.get(id)} ×${m}`)
        .join(", ");
      console.log("   📰 News intel: " + summary);
    } else {
      console.log("   📰 No clear news signals");
    }
  } catch (e) {
    console.log("   ⚠️  News adjustment skipped:", (e as Error).message);
  }

  return adjustments;
}


/**
 * Use Gemini's training knowledge to generate win probabilities for a race.
 * Returns a map of riderId → win probability (0-1), or empty map if AI call fails.
 * This gives the system knowledge of rider specialties, race profiles, and historical patterns
 * that ELO alone cannot capture (especially with limited 2026-only data).
 *
 * Only applied for road discipline races with ≥15 riders.
 * Blended 70% AI / 30% ELO for a more realistic probability distribution.
 */
/** Fetch post-race analysis from the most recent previous edition of this event */
async function getPreviousEditionAnalysis(raceEventId: string | null | undefined, gender: string): Promise<string | null> {
  if (!raceEventId) return null;
  try {
    // Find the race event's name to search for previous year's event
    const rows = await sql`
      SELECT r.post_race_analysis
      FROM races r
      JOIN race_events re2 ON re2.id = r.race_event_id
      JOIN race_events re_cur ON re_cur.id = ${raceEventId}
      WHERE re2.name = re_cur.name
        AND r.gender = ${gender}
        AND r.race_event_id != ${raceEventId}
        AND r.post_race_analysis IS NOT NULL
        AND r.status = 'completed'
      ORDER BY r.date DESC
      LIMIT 1
    `;
    return (rows[0] as any)?.post_race_analysis ?? null;
  } catch {
    return null;
  }
}

async function getAIKnowledgeProbabilities(
  raceName: string,
  raceDate: string,
  discipline: string,
  gender: string,
  riderNames: Map<string, string>,  // riderId → name
  raceEventId?: string | null
): Promise<Map<string, number>> {
  const probMap = new Map<string, number>();

  // Only use for road races where Gemini has reliable knowledge
  if (discipline !== "road") return probMap;

  // Normalize PCS ALL_CAPS format ("VINGEGAARD Jonas" → "Jonas Vingegaard") so Gemini
  // can recognize riders by their well-known names rather than PCS import format.
  function toProperCase(name: string): string {
    const words = name.split(" ");
    // Detect PCS ALL_CAPS format: first word is all uppercase letters
    if (words.length >= 2 && words[0] === words[0].toUpperCase() && /^[A-ZÀ-Ö]+$/.test(words[0])) {
      const lastName = words[0].charAt(0) + words[0].slice(1).toLowerCase();
      const firstName = words.slice(1).join(" ");
      return `${firstName} ${lastName}`;
    }
    return name;
  }
  const riderList = [...riderNames.values()].map(toProperCase).join("\n");
  const genderLabel = gender === "women" ? "Women\'s" : "Men\'s";
  const previousAnalysis = await getPreviousEditionAnalysis(raceEventId, gender);
  const analysisSection = previousAnalysis
    ? `\nLessons from our previous prediction for this race:\n${previousAnalysis}\n`
    : "";

  const prompt = `You are an expert professional cycling analyst with deep knowledge of riders, race profiles, and results up to early 2026.${analysisSection}

Race: ${raceName}
Date: ${raceDate}
Category: ${genderLabel} Elite Road Race

Startlist:
${riderList}

Based on your knowledge of:
- These riders\' proven strengths (climber, sprinter, classics specialist, etc.)
- This specific race\'s profile and the type of rider who typically wins
- Recent 2025-2026 season form and results
- Head-to-head history at this race and similar races

Assign realistic win probability percentages to the top 15 most likely winners.
The percentages must sum to exactly 100. All other riders share 0%.

Critical guidelines:
- Even the dominant favorite in a one-day classic rarely exceeds 35-40%
- A flat/sprint classic: spread probability across 6-10 sprinters
- A hilly classic (climbers viable): moderate favorite at 20-35%
- A punchy classic (cobbles/short climbs): 3-6 realistic contenders
- If a rider is not suited to this race\'s profile, give them 0%
- Use EXACT names from the startlist above

Return ONLY valid JSON, no text: {"ExactName": percentage_number, "ExactName2": percentage_number, ...}`;

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("   🤖 AI predictions: no JSON returned");
      return probMap;
    }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, number>;
    const normStr = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim().toLowerCase();

    // Build normalized word set for each rider (handles PCS ALL_CAPS format)
    function riderWords(rName: string): string[] {
      const n = normStr(rName);
      const words = rName.split(" ");
      const swapped = words[0] === words[0].toUpperCase() && words[0].length > 2
        ? normStr([words.slice(1).join(" "), words[0]].join(" "))
        : n;
      return [...new Set([...n.split(" "), ...swapped.split(" ")])].filter(w => w.length > 2);
    }

    let totalMapped = 0;
    const aiPicks: string[] = [];

    for (const [aiName, pct] of Object.entries(raw)) {
      if (typeof pct !== "number" || pct <= 0) continue;
      const nameWords = normStr(aiName).split(" ").filter(w => w.length > 2);

      let bestRiderId: string | null = null;
      let bestScore = 0;

      for (const [riderId, rName] of riderNames) {
        const rWords = riderWords(rName);
        const overlap = nameWords.filter(w => rWords.includes(w)).length;
        const hasLongWordMatch = nameWords.some(w => w.length >= 5 && rWords.includes(w));
        // Require surname-level match — no short first-name-only matches
        if (overlap >= 2 || (overlap >= 1 && hasLongWordMatch)) {
          const score = overlap * 10 + nameWords.filter(w => w.length >= 5 && rWords.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestRiderId = riderId; }
        }
      }

      if (bestRiderId && !probMap.has(bestRiderId)) {
        probMap.set(bestRiderId, pct / 100);
        totalMapped += pct;
        aiPicks.push(`${riderNames.get(bestRiderId)} ${pct.toFixed(0)}%`);
      }
    }

    if (aiPicks.length > 0) {
      console.log(`   🤖 AI picks (top 5): ${aiPicks.slice(0, 5).join(", ")}`);
      console.log(`   🤖 Mapped ${aiPicks.length} riders, total: ${totalMapped.toFixed(0)}%`);
    } else {
      console.log("   🤖 AI predictions: no riders matched startlist");
    }
  } catch (e) {
    console.log("   🤖 AI predictions skipped:", (e as Error).message?.substring(0, 60));
  }

  return probMap;
}

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Parse args
const args = process.argv.slice(2);
const raceIdIdx = args.indexOf("--race-id");
const SINGLE_RACE_ID = raceIdIdx !== -1 ? args[raceIdIdx + 1] : null;
const daysIdx = args.indexOf("--days");
const daysAhead = daysIdx !== -1 ? parseInt(args[daysIdx + 1]) : null;
const disciplineIdx = args.indexOf("--discipline");
const FILTER_DISCIPLINE = disciplineIdx !== -1 ? args[disciplineIdx + 1] : null;

const MIN_STARTLIST = 3;

async function generateForRace(raceId: string): Promise<void> {
  const race = await db.query.races.findFirst({
    where: eq(schema.races.id, raceId),
  });
  if (!race) { console.error(`Race not found: ${raceId}`); return; }

  const { discipline, ageCategory = "elite", gender = "men" } = race;
  console.log(`\n🏁 ${race.name} (${race.date})  [${discipline}/${ageCategory}/${gender}]`);

  const startlistEntries = await db.query.raceStartlist.findMany({
    where: eq(schema.raceStartlist.raceId, raceId),
    with: { rider: true },
  });

  if (startlistEntries.length < MIN_STARTLIST) {
    console.log(`   ⏭  Only ${startlistEntries.length} riders — skipping`);
    return;
  }

  console.log(`   Riders: ${startlistEntries.length}`);

  const skillsMap = new Map<string, RiderSkill>();
  const riderMeta = new Map<string, {
    name: string; racesTotal: number; uciPoints: number; rumourModifier: number;
  }>();

  for (const entry of startlistEntries) {
    const rider = entry.rider;
    if (!rider) continue;

    let stats = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(schema.riderDisciplineStats.riderId, rider.id),
        eq(schema.riderDisciplineStats.discipline, discipline),
        eq(schema.riderDisciplineStats.ageCategory, ageCategory),
        eq(schema.riderDisciplineStats.gender, gender)
      ),
    });

    if (!stats) {
      await db.insert(schema.riderDisciplineStats).values({
        riderId: rider.id, discipline, ageCategory, gender,
        currentElo: "1500", eloMean: "1500", eloVariance: "500",
        racesTotal: 0, uciPoints: 0,
      }).onConflictDoNothing();

      stats = await db.query.riderDisciplineStats.findFirst({
        where: and(
          eq(schema.riderDisciplineStats.riderId, rider.id),
          eq(schema.riderDisciplineStats.discipline, discipline),
          eq(schema.riderDisciplineStats.ageCategory, ageCategory),
          eq(schema.riderDisciplineStats.gender, gender)
        ),
      });
    }

    const racesTotal = stats?.racesTotal ?? 0;
    const uciPoints = stats?.uciPoints ?? 0;

    let skill: RiderSkill;
    if (racesTotal === 0) {
      // Unranked band: conservative estimate will be ~0–200, always below rated riders
      // (rated floor: mean=1500, σ=350 → conservative = 1500 - 3*350 = 450)
      // Scale UCI points logarithmically: 100pts→~70, 500pts→~150, 2000pts→~310, 5000pts→~390
      // Cap at 390 so even the highest-ranked unranked rider stays below the rated floor (~450)
      const uciBoost = uciPoints > 0 ? Math.min(Math.log(1 + uciPoints) * 30, 390) : 0;
      skill = { riderId: rider.id, mean: 300 + uciBoost, variance: 100 * 100 };
    } else {
      const mean = parseFloat(stats?.eloMean || "1500");
      const sigma = parseFloat(stats?.eloVariance || "350");
      skill = { riderId: rider.id, mean, variance: sigma * sigma };
    }

    // Apply rumour as mean nudge (±5%)
    const rumour = await db.query.riderRumours.findFirst({
      where: and(eq(schema.riderRumours.riderId, rider.id), eq(schema.riderRumours.raceId, raceId)),
    });
    const generalRumour = !rumour
      ? await db.query.riderRumours.findFirst({ where: eq(schema.riderRumours.riderId, rider.id) })
      : null;
    const rumourSentiment = rumour
      ? parseFloat(rumour.aggregateScore || "0")
      : generalRumour ? parseFloat(generalRumour.aggregateScore || "0") : 0;

    if (rumourSentiment !== 0) {
      skill = { ...skill, mean: skill.mean * (1 + rumourSentiment * 0.05) };
    }

    skillsMap.set(rider.id, skill);
    riderMeta.set(rider.id, { name: rider.name, racesTotal, uciPoints, rumourModifier: rumourSentiment * 0.05 });
  }

  // Apply race news adjustments (LLM reads headlines, boosts/penalizes named riders)
  const riderNamesMap = new Map([...riderMeta.entries()].map(([id, m]) => [id, m.name]));
  const newsAdjustments = await getNewsBasedAdjustments(race.raceEventId, riderNamesMap);
  for (const [riderId, multiplier] of newsAdjustments) {
    const skill = skillsMap.get(riderId);
    if (skill) skillsMap.set(riderId, { ...skill, mean: skill.mean * multiplier });
  }

  // Get AI knowledge-based win probabilities (Gemini knows rider profiles & race history)
  const aiProbabilities = await getAIKnowledgeProbabilities(
    race.name, race.date, race.discipline, race.gender ?? "men", riderNamesMap, race.raceEventId
  );

  // Monte-Carlo probability simulation via TrueSkill (ELO-based)
  const eloProbabilities = calculateAllProbabilities(skillsMap);

  // Blend: 70% AI knowledge + 30% ELO simulation for road races with AI picks
  // Pure ELO for MTB or when AI returned no picks
  const aiWeight = aiProbabilities.size > 0 && race.discipline === "road" ? 0.7 : 0.0;
  const eloWeight = 1 - aiWeight;

  // ── Blending: ELO base + AI signal ──────────────────────────────────────────
  // Problem with naive 70/30 blend: if AI only maps N riders (say 38% total prob),
  // the remaining riders get 0% AI weight → their blended prob collapses to 30% of ELO.
  // This tanks real favorites who happened to be missed by the AI name matcher.
  //
  // Fix: distribute the AI's "unaccounted" probability across un-mapped riders
  // proportional to their ELO win probability. This way a rider like Vingegaard
  // who is missed by the AI name match still gets a realistic probability.
  const totalAiMapped = [...aiProbabilities.values()].reduce((s, p) => s + p, 0);
  const aiUnaccounted = Math.max(0, 1.0 - totalAiMapped); // portion AI didn't assign

  // Sum ELO wins only for riders NOT named by AI (they share the unaccounted pool)
  let eloSumUnmapped = 0;
  for (const [riderId] of skillsMap) {
    if (!aiProbabilities.has(riderId)) {
      eloSumUnmapped += eloProbabilities.get(riderId)?.win ?? 0;
    }
  }

  const probabilities = new Map<string, { win: number; podium: number; top10: number }>();
  for (const [riderId] of skillsMap) {
    const elo = eloProbabilities.get(riderId) ?? { win: 0, podium: 0, top10: 0 };
    const meta = riderMeta.get(riderId)!;
    const skill = skillsMap.get(riderId)!;

    let effectiveAiWin: number;
    if (aiProbabilities.has(riderId)) {
      // AI explicitly named this rider — use their assigned probability
      effectiveAiWin = aiProbabilities.get(riderId)!;
    } else if (eloSumUnmapped > 0) {
      // AI didn't mention this rider — give them a share of unaccounted AI probability
      // proportional to their ELO win probability among all un-mapped riders
      effectiveAiWin = (aiUnaccounted * elo.win) / eloSumUnmapped;
    } else {
      effectiveAiWin = 0;
    }

    let win = aiWeight * effectiveAiWin + eloWeight * elo.win;

    // Sanity cap: domestiques/unknowns can't have high win probabilities.
    // Riders with 0 UCI points + low ELO + few races → cap at 1.5%.
    // This prevents name-matching bugs from surfacing domestiques as contenders.
    const isUnproven = meta.uciPoints === 0 && skill.mean < 1400 && meta.racesTotal < 15;
    const isWeakElo = meta.uciPoints < 50 && skill.mean < 1300;
    if (isUnproven || isWeakElo) {
      win = Math.min(win, 0.015);
    }

    probabilities.set(riderId, {
      win,
      podium: elo.podium,
      top10: elo.top10,
    });
  }

  // Rank: for road races use blended win probability; for MTB use conservative ELO rating
  const ranked = Array.from(skillsMap.entries())
    .map(([riderId, skill]) => ({
      riderId, skill,
      conservativeRating: calculateElo(skill.mean, skill.variance),
      meta: riderMeta.get(riderId)!,
      probs: probabilities.get(riderId) ?? { win: 0, podium: 0, top10: 0 },
    }))
    .sort((a, b) => {
      if (aiWeight > 0) return b.probs.win - a.probs.win;  // Sort by win prob when AI is active
      return b.conservativeRating - a.conservativeRating;  // Sort by ELO for MTB
    });

  await db.delete(schema.predictions).where(eq(schema.predictions.raceId, raceId));

  const predictionValues = ranked.map((r, i) => ({
    raceId, riderId: r.riderId,
    predictedPosition: i + 1,
    winProbability: r.probs.win.toFixed(4),
    podiumProbability: r.probs.podium.toFixed(4),
    top10Probability: r.probs.top10.toFixed(4),
    eloScore: r.conservativeRating.toFixed(4),
    rumourModifier: r.meta.rumourModifier.toFixed(4),
    confidenceScore: r.meta.racesTotal > 0
      ? r.meta.uciPoints > 0 ? "0.7000" : "0.5000"
      : r.meta.uciPoints > 0 ? "0.3000" : "0.1000",
    version: 1,
  }));

  for (let i = 0; i < predictionValues.length; i += 50) {
    await db.insert(schema.predictions).values(predictionValues.slice(i, i + 50));
  }

  console.log(`   ✅ ${predictionValues.length} predictions saved`);
  console.log(`   Top 5:`);
  for (const r of ranked.slice(0, 5)) {
    const label = r.meta.racesTotal > 0
      ? `μ=${r.skill.mean.toFixed(0)} σ=${Math.sqrt(r.skill.variance).toFixed(0)} → ${r.conservativeRating.toFixed(0)}`
      : `unranked (uci=${r.meta.uciPoints})`;
    console.log(`     ${String(ranked.indexOf(r) + 1).padStart(2)}. ${r.meta.name.padEnd(28)} win=${(r.probs.win * 100).toFixed(1)}%  [${label}]`);
  }

  try { await notifyRaceEventFollowers(raceId); } catch (_) {}
}

async function main() {
  if (SINGLE_RACE_ID) {
    await generateForRace(SINGLE_RACE_ID);
    return;
  }

  const days = daysAhead ?? 3;
  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

  const races = await db.query.races.findMany({
    where: and(
      eq(schema.races.status, "active"),
      gte(schema.races.date, today),
      lte(schema.races.date, maxDate),
      ...(FILTER_DISCIPLINE ? [eq(schema.races.discipline, FILTER_DISCIPLINE)] : []),
    ),
    orderBy: (r, { asc }) => [asc(r.date)],
  });

  if (races.length === 0) { console.log("No active races in window."); return; }
  console.log(`Found ${races.length} races in next ${days} day(s)\n`);

  let generated = 0, skipped = 0;

  for (const race of races) {
    const startlistSize = await db.query.raceStartlist
      .findMany({ where: eq(schema.raceStartlist.raceId, race.id) })
      .then((r) => r.length);

    if (startlistSize < MIN_STARTLIST) {
      console.log(`  ⏭  ${race.name} — ${startlistSize} riders`);
      skipped++; continue;
    }

    const existing = await db.query.predictions.findFirst({
      where: eq(schema.predictions.raceId, race.id),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });

    if (existing?.createdAt) {
      const ageHours = (Date.now() - new Date(existing.createdAt).getTime()) / 3600000;
      if (ageHours < 1) {
        console.log(`  ⏭  ${race.name} — fresh (${ageHours.toFixed(1)}h ago)`);
        skipped++; continue;
      }
    }

    await generateForRace(race.id);
    generated++;
  }

  console.log(`\nDone — ${generated} generated, ${skipped} skipped`);
}

main().catch(console.error);
