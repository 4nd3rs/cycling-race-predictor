/**
 * analyze-race-results.ts
 *
 * Post-race analysis agent: compares predictions vs actual results using
 * Gemini AI + race news articles. Stores a short expert analysis on each
 * completed race row. Also used as context for future predictions of the
 * same event.
 *
 * Usage:
 *   tsx scripts/agents/analyze-race-results.ts              # auto-find unanalyzed completed races
 *   tsx scripts/agents/analyze-race-results.ts --race-id <uuid>   # specific race
 *   tsx scripts/agents/analyze-race-results.ts --days-back 14     # look further back
 *   tsx scripts/agents/analyze-race-results.ts --dry-run          # print analysis, don't save
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { GoogleGenerativeAI } from "@google/generative-ai";

const sql = neon(process.env.DATABASE_URL!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const args = process.argv.slice(2);
const specificRaceId = args.includes("--race-id") ? args[args.indexOf("--race-id") + 1] : null;
const daysBack = args.includes("--days-back") ? parseInt(args[args.indexOf("--days-back") + 1]) : 7;
const dryRun = args.includes("--dry-run");

interface RaceRow {
  id: string;
  name: string;
  date: string;
  gender: string;
  discipline: string;
  eventName: string;
  eventSlug: string | null;
}

interface PredictionRow {
  riderName: string;
  predictedPosition: number | null;
  winProbability: string | null;
}

interface ResultRow {
  position: number;
  riderName: string;
}

interface NewsRow {
  title: string;
  content: string | null;
  publishedAt: string | null;
}

// ---------------------------------------------------------------------------

async function runMigrationIfNeeded() {
  try {
    await sql`
      ALTER TABLE races
        ADD COLUMN IF NOT EXISTS post_race_analysis text,
        ADD COLUMN IF NOT EXISTS analysis_generated_at timestamptz
    `;
  } catch {
    // Columns may already exist; ignore
  }
}

async function findUnanalyzedRaces(): Promise<RaceRow[]> {
  const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  return sql`
    SELECT r.id, r.name, r.date, r.gender, r.discipline,
           re.name as "eventName", re.slug as "eventSlug"
    FROM races r
    JOIN race_events re ON re.id = r.race_event_id
    WHERE r.status = 'completed'
      AND r.date >= ${cutoff}
      AND r.discipline = 'road'
      AND r.age_category = 'elite'
      AND r.post_race_analysis IS NULL
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_id = r.id LIMIT 1)
      AND EXISTS (SELECT 1 FROM predictions p WHERE p.race_id = r.id LIMIT 1)
    ORDER BY r.date DESC
    LIMIT 5
  ` as unknown as RaceRow[];
}

async function getPredictions(raceId: string): Promise<PredictionRow[]> {
  return sql`
    SELECT ri.name as "riderName", p.predicted_position as "predictedPosition",
           p.win_probability as "winProbability"
    FROM predictions p
    JOIN riders ri ON ri.id = p.rider_id
    WHERE p.race_id = ${raceId}
    ORDER BY p.predicted_position ASC NULLS LAST
    LIMIT 15
  ` as unknown as PredictionRow[];
}

async function getResults(raceId: string): Promise<ResultRow[]> {
  return sql`
    SELECT rr.position, ri.name as "riderName"
    FROM race_results rr
    JOIN riders ri ON ri.id = rr.rider_id
    WHERE rr.race_id = ${raceId}
    ORDER BY rr.position ASC
    LIMIT 15
  ` as unknown as ResultRow[];
}

async function getNews(eventId: string): Promise<NewsRow[]> {
  // Fetch news for this race event (last 2 weeks before/after race)
  return sql`
    SELECT title, content, published_at as "publishedAt"
    FROM race_news
    WHERE race_event_id = ${eventId}
      AND title IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 10
  ` as unknown as NewsRow[];
}

async function getEventId(raceId: string): Promise<string | null> {
  const rows = await sql`
    SELECT re.id FROM races r JOIN race_events re ON re.id = r.race_event_id WHERE r.id = ${raceId}
  ` as { id: string }[];
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------

function buildPrompt(
  race: RaceRow,
  predictions: PredictionRow[],
  results: ResultRow[],
  news: NewsRow[]
): string {
  const predLines = predictions
    .map((p, i) => {
      const wp = p.winProbability ? (parseFloat(p.winProbability) * 100).toFixed(1) : "?";
      return `  ${i + 1}. ${p.riderName} (win: ${wp}%)`;
    })
    .join("\n");

  const resultLines = results
    .slice(0, 10)
    .map(r => `  ${r.position}. ${r.riderName}`)
    .join("\n");

  const newsLines = news
    .filter(n => n.title)
    .slice(0, 6)
    .map(n => {
      const snippet = n.content ? `  "${n.content.slice(0, 200).replace(/\s+/g, " ")}"` : "";
      return `- ${n.title}${snippet ? "\n" + snippet : ""}`;
    })
    .join("\n");

  return `You are an expert cycling analyst. Write a concise post-race analysis comparing predictions vs actual results.

Race: ${race.eventName} ${new Date(race.date).getFullYear()} — ${race.name}
Date: ${new Date(race.date).toISOString().split("T")[0]}
Gender: ${race.gender}

OUR PREDICTIONS (top 15):
${predLines || "  (no predictions)"}

ACTUAL RESULTS (top 10):
${resultLines || "  (no results)"}

NEWS & RACE REPORTS:
${newsLines || "  (no news articles available)"}

Write exactly 2-3 short paragraphs (no headers, no bullet points):
1. Prediction accuracy — did we get the winner right? How many top-3 did we nail? Be specific.
2. What actually decided the race (tactics, weather, form, attacks) — draw from news if available.
3. One or two concrete lessons for predicting this type of race in future (e.g. "in bad weather, underweight pure sprinters" or "this course suits attackers over pure climbers").

Tone: analytical, direct, like a sports journalist. No fluff. Max 150 words total.`;
}

// ---------------------------------------------------------------------------

async function analyzeRace(race: RaceRow): Promise<void> {
  console.log(`\n🔍 Analyzing: ${race.eventName} (${race.name}, ${new Date(race.date).toISOString().split("T")[0]})`);

  const [predictions, results, eventId] = await Promise.all([
    getPredictions(race.id),
    getResults(race.id),
    getEventId(race.id),
  ]);

  if (results.length === 0) {
    console.log("  ⚠️ No results found — skipping");
    return;
  }
  if (predictions.length === 0) {
    console.log("  ⚠️ No predictions found — skipping");
    return;
  }

  const news = eventId ? await getNews(eventId) : [];

  const prompt = buildPrompt(race, predictions, results, news);
  console.log(`  📰 News articles: ${news.length}, Predictions: ${predictions.length}, Results: ${results.length}`);

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const response = await model.generateContent(prompt);
  const analysis = response.response.text().trim();

  console.log("\n  📝 Analysis:\n");
  console.log(analysis.split("\n").map(l => "    " + l).join("\n"));

  if (!dryRun) {
    await sql`
      UPDATE races
      SET post_race_analysis = ${analysis},
          analysis_generated_at = NOW()
      WHERE id = ${race.id}
    `;
    console.log("  ✅ Saved to DB");
  } else {
    console.log("\n  [DRY RUN — not saved]");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("🏁 Race Analysis Agent");
  console.log(`   Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  await runMigrationIfNeeded();

  let races: RaceRow[];

  if (specificRaceId) {
    const rows = await sql`
      SELECT r.id, r.name, r.date, r.gender, r.discipline,
             re.name as "eventName", re.slug as "eventSlug"
      FROM races r JOIN race_events re ON re.id = r.race_event_id
      WHERE r.id = ${specificRaceId}
    ` as unknown as RaceRow[];
    races = rows;
  } else {
    races = await findUnanalyzedRaces();
  }

  if (races.length === 0) {
    console.log("✅ No races need analysis right now.");
    return;
  }

  console.log(`\nFound ${races.length} race(s) to analyze`);

  for (const race of races) {
    try {
      await analyzeRace(race);
    } catch (err) {
      console.error(`  ❌ Error analyzing ${race.name}:`, (err as Error).message);
    }
    // Rate limit: pause between Gemini calls
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n🏁 Done");
}

main().catch(console.error);
