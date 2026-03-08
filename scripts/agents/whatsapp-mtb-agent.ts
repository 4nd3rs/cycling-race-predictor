/**
 * whatsapp-mtb-agent.ts
 * Posts MTB race news, previews, and results to the PCP MTB WhatsApp channel.
 * Called by cron with --mode preview|raceday|results|news
 *
 * Sends via post-to-whatsapp-channel.js (Baileys, stops/restarts OpenClaw gateway).
 * Focuses on Elite Men + Elite Women only.
 * Priority: WorldCup > C1/CC > C2 (WorldCup always posts, others if good predictions exist)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceResults, raceEvents, riders, predictions } from "./lib/db";
import { eq, and, gte, lte, desc, isNotNull, sql } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";

const APP_URL = "https://procyclingpredictor.com";
const MTB_WA_GROUP = "120363405998540593@g.us";
const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;

const MTB_HIGH_PRIORITY = new Set(["WorldCup", "World Cup", "WHOOP UCI MTB World Series", "CC"]);
const MTB_MED_PRIORITY  = new Set(["C1", "HC"]);
const ELITE_CATS        = new Set(["elite-men", "elite-women"]);

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genai.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const mode    = process.argv.find(a => a.startsWith("--mode="))?.split("=")[1]
             ?? process.argv[process.argv.indexOf("--mode") + 1]
             ?? "news";
const dryRun  = process.argv.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────────────

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function parseDate(raw: string | Date): string {
  return new Date(raw as string).toISOString().slice(0, 10);
}

function formatCountry(code: string | null): string {
  if (!code) return "";
  const map: Record<string, string> = {
    ITA:"Italy", FRA:"France", ESP:"Spain", USA:"USA", CAN:"Canada", AUS:"Australia",
    AUT:"Austria", GER:"Germany", SUI:"Switzerland", NED:"Netherlands", BEL:"Belgium",
    GBR:"Great Britain", SRB:"Serbia", JPN:"Japan", ARG:"Argentina", BRA:"Brazil",
    CZE:"Czech Republic", SVK:"Slovakia", POL:"Poland", SLO:"Slovenia", CRO:"Croatia",
    RSA:"South Africa", CHI:"Chile", MEX:"Mexico", NZL:"New Zealand",
  };
  return map[code] ?? code;
}

async function sendToGroup(text: string): Promise<void> {
  if (dryRun) {
    console.log("── DRY RUN ──────────────────────────────");
    console.log(text);
    console.log("─────────────────────────────────────────");
    return;
  }
  const res = await fetch(`${OPENCLAW_GATEWAY}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ to: MTB_WA_GROUP, text }),
  });
  if (!res.ok) throw new Error(`Gateway send failed: ${res.status} ${await res.text()}`);
  console.log("✅ Sent to MTB WA group");
}

async function generate(prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  if (/\[.*name.*\]|\[.*placeholder.*\]/i.test(text)) {
    throw new Error(`Gemini returned unfilled placeholders: ${text.slice(0, 100)}`);
  }
  return text;
}

// ── Data queries ──────────────────────────────────────────────────────────────

async function getMtbRaces(dayMin: number, dayMax: number, eliteOnly = true) {
  const q = db
    .select({
      id: races.id, name: races.name, date: races.date,
      uciCategory: races.uciCategory, categorySlug: races.categorySlug,
      raceEventId: races.raceEventId,
      eventName: raceEvents.name, eventSlug: raceEvents.slug, country: raceEvents.country,
    })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, "mtb"),
      eq(races.status, "active"),
      gte(races.date, dayStr(dayMin)),
      lte(races.date, dayStr(dayMax)),
    ))
    .orderBy(races.date);

  const all = await q;
  return eliteOnly
    ? all.filter(r => ELITE_CATS.has(r.categorySlug ?? ""))
    : all;
}

function priorityScore(uciCategory: string | null): number {
  if (!uciCategory) return 0;
  if (MTB_HIGH_PRIORITY.has(uciCategory)) return 3;
  if (MTB_MED_PRIORITY.has(uciCategory)) return 2;
  if (uciCategory === "C2") return 1;
  return 0;
}

async function getTopPredictions(raceId: string, limit = 5) {
  const preds = await db
    .select({
      name: riders.name,
      winProbability: predictions.winProbability,
    })
    .from(predictions)
    .leftJoin(riders, eq(predictions.riderId, riders.id))
    .where(and(eq(predictions.raceId, raceId), isNotNull(predictions.winProbability)))
    .orderBy(desc(predictions.winProbability))
    .limit(limit * 2);

  // Deduplicate by first two name tokens
  const seen = new Set<string>();
  return preds
    .filter(p => {
      const key = (p.name ?? "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function getResults(raceId: string, limit = 10) {
  return db
    .select({ position: raceResults.position, riderName: riders.name })
    .from(raceResults)
    .leftJoin(riders, eq(raceResults.riderId, riders.id))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(raceResults.position)
    .limit(limit);
}

// ── Dedup by event slug (one post per event, prefer men's over women's) ───────

function deduplicateByEvent<T extends { eventSlug?: string | null; id: string; categorySlug?: string | null }>(races: T[]): T[] {
  const bySlug = new Map<string, T>();
  for (const race of races) {
    const key = race.eventSlug ?? race.id;
    const existing = bySlug.get(key);
    if (!existing) { bySlug.set(key, race); continue; }
    if (race.categorySlug === "elite-men" && existing.categorySlug !== "elite-men") bySlug.set(key, race);
  }
  return Array.from(bySlug.values());
}

// ── Mode: NEWS ────────────────────────────────────────────────────────────────

async function postNews() {
  const upcoming = await getMtbRaces(0, 14);
  if (upcoming.length === 0) { console.log("No upcoming MTB races in 14 days"); return; }

  const deduped = deduplicateByEvent(upcoming);
  const highPri = deduped.filter(r => priorityScore(r.uciCategory) >= 2).slice(0, 3);
  const racesText = highPri
    .map(r => `- ${r.eventName ?? r.name} (${formatCountry(r.country ?? null)}, ${parseDate(r.date as string)}, ${r.uciCategory ?? "UCI"})`)
    .join("\n");
  const raceLinks = highPri
    .filter(r => r.eventSlug)
    .map(r => `${r.eventName ?? r.name} → ${APP_URL}/races/mtb/${r.eventSlug}`)
    .join("\n");

  if (highPri.length === 0) { console.log("No priority MTB races — skipping news post"); return; }

  const prompt = `You write punchy WhatsApp messages for a pro cycling predictions app called Pro Cycling Predictor.
Write a short, engaging MTB weekly roundup (max 120 words).
Use *bold* for names and race names. No hashtags. Max 2 emojis. No markdown headers.

Upcoming MTB races this week:
${racesText}

Race links (ONLY link races you mention):
${raceLinks || "No links — do NOT add any."}

Rules:
- Conversational, like a knowledgeable MTB fan
- Focus on the biggest upcoming race
- If WorldCup or Continental Champs — highlight it
- End with 👉 link to most relevant race (only if available above)`;

  const text = await generate(prompt);
  await sendToGroup(text);
}

// ── Mode: PREVIEW ─────────────────────────────────────────────────────────────

async function postPreview() {
  const upcoming = await getMtbRaces(1, 2);
  const deduped = deduplicateByEvent(upcoming);

  // Only preview WorldCup / C1 / CC
  const eligible = deduped.filter(r => priorityScore(r.uciCategory) >= 2);
  if (eligible.length === 0) { console.log("No priority MTB races in 48h for preview"); return; }

  for (const race of eligible.slice(0, 2)) {
    const preds = await getTopPredictions(race.id, 5);
    const country = formatCountry(race.country ?? null);
    const url = race.eventSlug ? `${APP_URL}/races/mtb/${race.eventSlug}` : APP_URL;

    if (preds.length === 0) {
      console.log(`⚠️  No predictions for ${race.eventName ?? race.name} — skipping preview`);
      continue;
    }

    const predText = preds.map((p, i) => `${i + 1}. ${p.name}`).join("\n");

    const prompt = `You write punchy WhatsApp race preview messages for Pro Cycling Predictor.
Write a sharp MTB race preview for *${race.eventName ?? race.name}* (${parseDate(race.date as string)}, ${country}).
UCI class: ${race.uciCategory ?? "UCI"}.

Our top predicted picks:
${predText}

Format:
🚵 *Race name* — date, country
[2-3 sentences: what makes this race interesting, terrain, key matchups]

🔮 *Our top picks:*
1. Name
2. Name
3. Name

👉 Full preview + predictions: ${url}

Rules:
- Max 130 words total
- *bold* for rider and race names
- Sound like a knowledgeable MTB fan, not a press release
- No hashtags, max 2 emojis`;

    const text = await generate(prompt);
    await sendToGroup(text);
  }
}

// ── Mode: RACEDAY ─────────────────────────────────────────────────────────────

async function postRaceDay() {
  const todayRaces = await getMtbRaces(0, 0);
  const deduped = deduplicateByEvent(todayRaces);
  const eligible = deduped.filter(r => priorityScore(r.uciCategory) >= 2);

  if (eligible.length === 0) { console.log("No priority MTB races today"); return; }

  for (const race of eligible.slice(0, 2)) {
    const preds = await getTopPredictions(race.id, 3);
    if (preds.length === 0) { console.log(`⚠️  No predictions for raceday ${race.eventName ?? race.name}`); continue; }

    const url = race.eventSlug ? `${APP_URL}/races/mtb/${race.eventSlug}` : APP_URL;
    const topPick = preds[0]?.name ?? "unknown";

    const prompt = `Short race-day WhatsApp hype message for MTB race: ${race.eventName ?? race.name} (${race.uciCategory}).
Our top pick today: ${topPick}${preds[1] ? `, watch for ${preds[1].name}` : ""}.

Max 80 words. Start with 🚵 and race name in *bold*.
One sharp tactical insight. End with predictions link: ${url}
No hashtags.`;

    const text = await generate(prompt);
    await sendToGroup(text);
  }
}

// ── Mode: RESULTS ─────────────────────────────────────────────────────────────

async function postResults() {
  // Completed MTB races from last 2 days
  const recentRaw = await db
    .select({
      id: races.id, name: races.name, date: races.date,
      uciCategory: races.uciCategory, categorySlug: races.categorySlug,
      eventName: raceEvents.name, eventSlug: raceEvents.slug, country: raceEvents.country,
    })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, "mtb"),
      gte(races.date, dayStr(-2)),
      lte(races.date, dayStr(0)),
      sql`${races.id} IN (SELECT race_id FROM race_results GROUP BY race_id)`,
    ))
    .orderBy(desc(races.date));

  // Filter elite only + priority
  const eligible = recentRaw
    .filter(r => ELITE_CATS.has(r.categorySlug ?? "") && priorityScore(r.uciCategory) >= 2);

  if (eligible.length === 0) { console.log("No completed priority MTB races to post results for"); return; }

  // Dedup by event — post one per event (prefer men's, but post women's too if WC)
  const bySlug = new Map<string, typeof eligible>();
  for (const race of eligible) {
    const key = race.eventSlug ?? race.id;
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key)!.push(race);
  }

  for (const [, group] of Array.from(bySlug.entries()).slice(0, 2)) {
    // Post results for each gender separately for WorldCup, otherwise just men's
    const toPost = MTB_HIGH_PRIORITY.has(group[0]?.uciCategory ?? "")
      ? group  // both genders for World Cup
      : group.filter(r => r.categorySlug === "elite-men").slice(0, 1); // men only for C1

    for (const race of toPost) {
      const results = await getResults(race.id);
      if (results.length < 3) {
        console.log(`⚠️  Not enough results for ${race.name}`);
        continue;
      }

      const podium = results.slice(0, 3).map((r, i) => `${i + 1}. *${r.riderName}*`).join("\n");
      const url = race.eventSlug ? `${APP_URL}/races/mtb/${race.eventSlug}` : APP_URL;
      const gender = race.categorySlug === "elite-women" ? "Women's" : "Men's";

      const prompt = `Short WhatsApp results post for ${gender} ${race.eventName ?? race.name} (${race.uciCategory}).

Podium:
${podium}

Max 90 words. Open with 🏆 and winner's name in *bold*.
One punchy insight (who dominated, surprise, key battle).
End with results link: ${url}
No hashtags.`;

      const text = await generate(prompt);
      await sendToGroup(text);
      // Brief pause between men's and women's posts
      if (toPost.length > 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const handlers: Record<string, () => Promise<void>> = {
  news:     postNews,
  preview:  postPreview,
  raceday:  postRaceDay,
  results:  postResults,
};

const handler = handlers[mode];
if (!handler) {
  console.error(`Unknown mode: ${mode}. Use: news|preview|raceday|results`);
  process.exit(1);
}

handler().catch(err => { console.error(err); process.exit(1); });
