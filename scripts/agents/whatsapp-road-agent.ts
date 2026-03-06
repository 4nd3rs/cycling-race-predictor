/**
 * whatsapp-road-agent.ts
 * Posts race news, previews, and results to the PCP Road WhatsApp group.
 * Called by cron with --mode preview|raceday|results|news
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, races, raceResults, raceEvents, riders, raceStartlist, teams, predictions, userFollows, userWhatsapp } from "./lib/db";
import { eq, and, gte, lte, lt, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const WA_GROUP = "120363425402092416@g.us";
const OPENCLAW_GATEWAY = "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;
const CRON_SECRET = process.env.CRON_SECRET!;
const APP_URL = "https://procyclingpredictor.com";

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genai.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const mode = process.argv[2] ?? "news";
const dryRun = process.argv.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function daysFromNow(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function parseDate(raw: string) { return new Date(raw).toISOString().slice(0, 10); }

async function sendToWA(text: string) {
  if (dryRun) { console.log("DRY RUN:\n" + text); return; }
  const res = await fetch(`${OPENCLAW_GATEWAY}/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({
      tool: "message",
      args: { action: "send", channel: "whatsapp", target: WA_GROUP, message: text },
    }),
  });
  if (!res.ok) throw new Error(`Gateway send failed: ${res.status} ${await res.text()}`);
  console.log("✅ Sent to WA group");
}

async function generate(prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  // Safeguard: reject output containing unfilled template placeholders
  if (/\[Top Pick \d+ Name\]|\[.*Name.*\]|\[.*placeholder.*\]/i.test(text)) {
    throw new Error(`Gemini returned unfilled template placeholders: ${text.slice(0, 100)}`);
  }
  return text;
}

function loadTodayIntel() {
  const file = `./data/intel/${today()}.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}

// ── Group interest filter ─────────────────────────────────────────────────────
// Returns the set of race_event IDs followed by users who have a WA phone registered.
// WT/WorldTour races are always included regardless of follows.
let _cachedFollowedEventIds: Set<string> | null = null;

async function getGroupFollowedEventIds(): Promise<Set<string>> {
  if (_cachedFollowedEventIds) return _cachedFollowedEventIds;

  // All users with a registered WA phone
  const waUsers = await db.select({ userId: userWhatsapp.userId })
    .from(userWhatsapp);
  const userIds = waUsers.map(u => u.userId);

  if (userIds.length === 0) {
    _cachedFollowedEventIds = new Set();
    return _cachedFollowedEventIds;
  }

  // Their race_event follows
  const follows = await db.select({ entityId: userFollows.entityId })
    .from(userFollows)
    .where(and(
      eq(userFollows.followType, "race_event"),
      inArray(userFollows.userId, userIds),
    ));

  _cachedFollowedEventIds = new Set(follows.map(f => f.entityId));
  console.log(`📋 Group interest: ${_cachedFollowedEventIds.size} followed events from ${userIds.length} registered members`);
  return _cachedFollowedEventIds;
}

// Check if a race is relevant to group members (followed, OR WorldTour/WT category)
async function isRaceOfInterest(raceEventId: string | null, uciCategory?: string | null): Promise<boolean> {
  if (!raceEventId) return false;
  // Always include WorldTour (covers both men's WT and women's WWT) — universally interesting
  if (uciCategory === "WorldTour") return true;
  const followed = await getGroupFollowedEventIds();
  // If nobody has follows yet, default to allow-all (graceful degradation)
  if (followed.size === 0) return true;
  return followed.has(raceEventId);
}

// ── Race queries ──────────────────────────────────────────────────────────────

async function getUpcomingRaces(dayMin: number, dayMax: number) {
  return db.select({
    id: races.id, name: races.name, date: races.date, discipline: races.discipline,
    gender: races.gender, uciCategory: races.uciCategory,
    raceEventId: races.raceEventId, pcsUrl: races.pcsUrl,
    eventName: raceEvents.name, eventSlug: raceEvents.slug, country: raceEvents.country,
  })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, "road"),
      gte(races.date, daysFromNow(dayMin)),
      lte(races.date, daysFromNow(dayMax)),
      eq(races.status, "active"),
    ))
    .orderBy(races.date);
}

async function getTopPredictions(raceId: string, limit = 5) {
  // Use win_probability (TrueSkill) — NOT predictedPosition which is often null
  const preds = await db.select({
    name: riders.name, team: teams.name, winProbability: predictions.winProbability,
  })
    .from(predictions)
    .leftJoin(riders, eq(predictions.riderId, riders.id))
    .leftJoin(raceStartlist, and(eq(raceStartlist.raceId, raceId), eq(raceStartlist.riderId, predictions.riderId)))
    .leftJoin(teams, eq(raceStartlist.teamId, teams.id))
    .where(and(eq(predictions.raceId, raceId), isNotNull(predictions.winProbability)))
    .orderBy(desc(predictions.winProbability))
    .limit(limit * 3); // fetch extra to deduplicate by name
  // Deduplicate by normalized first two name tokens (handles suffix variants)
  const seen = new Set<string>();
  const deduped = preds.filter(p => {
    const key = (p.name ?? "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, limit);
}

async function getRecentResults(raceId: string) {
  return db.select({ position: raceResults.position, riderName: riders.name, teamName: teams.name })
    .from(raceResults)
    .leftJoin(riders, eq(raceResults.riderId, riders.id))
    .leftJoin(teams, eq(raceResults.teamId, teams.id))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(raceResults.position)
    .limit(10);
}

// ── Mode: NEWS — daily interesting content ─────────────────────────────────

async function postNews() {
  const intel = loadTodayIntel();
  const upcoming = await getUpcomingRaces(0, 7);
  if (intel.length === 0 && upcoming.length === 0) { console.log("Nothing to post"); return; }

  const intelText = intel.slice(0, 5).map(i => `- ${i.title} (via ${i.source_name ?? i.source ?? "cycling media"})`).join("\n");
  const upcomingText = upcoming.slice(0, 3).map(r => `- ${r.eventName ?? r.name}: ${parseDate(r.date as string)}`).join("\n");
  const raceLinks = upcoming
    .filter(r => r.eventSlug)
    .map(r => `${r.eventName ?? r.name} → ${APP_URL}/races/road/${r.eventSlug}`);

  const prompt = `You write punchy WhatsApp messages for a pro cycling predictions app called Pro Cycling Predictor.
Write a short, engaging WhatsApp message (max 130 words) about what's happening in road cycling this week.
Use *bold* for names and race names. No hashtags. Max 2-3 emojis.

Upcoming races this week:
${upcomingText || "None"}

Today's news headlines (attribute each with "via Source" inline):
${intelText || "No news today"}

Race pages you can link to (ONLY link races you actually mention):
${raceLinks.length > 0 ? raceLinks.join("\n") : "No race pages available — do NOT add any link."}

Rules:
- Conversational, like a knowledgeable cycling fan
- Lead with the most interesting thing
- Attribute news sources inline (e.g. "via CyclingNews")
- If a race is today or tomorrow, make that the focus
- End with 👉 link to the most relevant race you mentioned (only if it has a page above)`;

  const text = await generate(prompt);
  await sendToWA(text);
}

// ── Mode: PREVIEW — 48h before race ─────────────────────────────────────────

async function postPreview() {
  const races48h = await getUpcomingRaces(1, 2);
  if (races48h.length === 0) { console.log("No races in 48h window"); return; }

  // Dedup by event slug — one preview per event (avoids men's+women's double-post).
  // For each event slug, pick the gender with the most predictions (prefer men's on tie).
  const bySlug = new Map<string, typeof races48h[0]>();
  for (const race of races48h) {
    const key = race.eventSlug ?? race.id;
    const existing = bySlug.get(key);
    if (!existing) { bySlug.set(key, race); continue; }
    // Replace with men's edition if current slot is women's (men's has more/better predictions usually)
    if ((race as any).gender === "men" && (existing as any).gender !== "men") bySlug.set(key, race);
  }
  // From all unique events, pick up to 2 that are of interest AND have predictions
  const racesWithPreds: Array<{ race: typeof races48h[0]; preds: Awaited<ReturnType<typeof getTopPredictions>> }> = [];
  for (const race of Array.from(bySlug.values())) {
    const interested = await isRaceOfInterest(race.raceEventId, race.uciCategory);
    if (!interested) {
      console.log(`⏭️  Skipping ${race.eventName ?? race.name} — not followed by group members`);
      continue;
    }
    const preds = await getTopPredictions(race.id);
    if (preds.length === 0) {
      console.log(`⚠️  Skipping ${race.eventName ?? race.name} — no predictions in DB`);
      continue;
    }
    racesWithPreds.push({ race, preds });
    if (racesWithPreds.length >= 2) break;
  }
  if (racesWithPreds.length === 0) { console.log("No races with predictions in 48h window"); return; }

  for (const { race, preds } of racesWithPreds) {

    const intel = loadTodayIntel().filter(i =>
      i.type === "race" && i.subject.toLowerCase().includes((race.eventName ?? race.name).toLowerCase().split(" ")[0])
    );

    const predText = preds.map((p, i) => `${i + 1}. ${p.name} (${p.team ?? "?"})` ).join("\n");

    const url = race.eventSlug
      ? `${APP_URL}/races/road/${race.eventSlug}`
      : APP_URL;

    const prompt = `You write punchy WhatsApp race preview messages for Pro Cycling Predictor.
Write a sharp race preview for ${race.eventName ?? race.name} (${parseDate(race.date as string)}).

Our top predictions:
${predText}

${intel.length > 0 ? "Latest intel:\n" + intel.map(i => `- ${i.title}`).join("\n") : ""}

Format:
🏁 *Race name* — date
[2-3 sentences about the race, what to look for, who to watch]

🔮 *Our top picks:*
1. Name
2. Name  
3. Name

👉 Full preview: ${url}

Rules:
- Max 150 words total
- *bold* for rider and race names
- Sound like a knowledgeable cycling fan, not a press release
- 1-2 emojis max`;

    const text = await generate(prompt);
    await sendToWA(text);
  }
}

// ── Mode: RACEDAY — morning of race ──────────────────────────────────────────

async function postRaceDay() {
  const todayRaces = await getUpcomingRaces(0, 0);
  if (todayRaces.length === 0) { console.log("No races today"); return; }

  // Dedup by event slug
  const seenRD = new Set<string>();
  const uniqueToday = todayRaces.filter(r => { const k = r.eventSlug ?? r.id; if (seenRD.has(k)) return false; seenRD.add(k); return true; });

  for (const race of uniqueToday.slice(0, 2)) {
    const interested = await isRaceOfInterest(race.raceEventId, race.uciCategory);
    if (!interested) { console.log(`⏭️  Skipping raceday ${race.eventName ?? race.name} — not followed by group members`); continue; }
    const preds = await getTopPredictions(race.id, 3);
    const url = race.eventSlug ? `${APP_URL}/races/road/${race.eventSlug}` : APP_URL;

    if (preds.length === 0) { console.log(`⚠️  Skipping raceday ${race.eventName ?? race.name} — no predictions`); continue; }
    const topPick = preds[0]?.name ?? "unknown";

    const prompt = `Short race-day WhatsApp hype message for ${race.eventName ?? race.name}.
Our top pick: ${topPick}${preds[1] ? ` (chased by ${preds[1].name})` : ""}.

Max 80 words. Start with a 🚴 emoji and the race name in bold. End with a link.
Sound excited. One key tactical insight. 
Link: ${url}`;

    const text = await generate(prompt);
    await sendToWA(text);
  }
}

// ── Mode: RESULTS — after race ────────────────────────────────────────────────

async function postResults() {
  // Find races from yesterday/today that are now completed
  const window = await db.select({
    id: races.id, name: races.name, date: races.date, uciCategory: races.uciCategory,
    raceEventId: races.raceEventId, eventName: raceEvents.name, eventSlug: raceEvents.slug,
  })
    .from(races)
    .leftJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
    .where(and(
      eq(races.discipline, "road"),
      eq(races.status, "completed"),
      gte(races.date, daysFromNow(-2)),
      lte(races.date, daysFromNow(0)),
    ))
    .orderBy(desc(races.date))
    .limit(3);

  if (window.length === 0) { console.log("No completed races to post"); return; }

  for (const race of window) {
    const interested = await isRaceOfInterest(race.raceEventId ?? null, race.uciCategory);
    if (!interested) { console.log(`⏭️  Skipping results ${race.eventName ?? race.name} — not followed by group members`); continue; }
    const results = await getRecentResults(race.id);
    if (results.length < 3) continue;

    const podium = results.slice(0, 3).map((r, i) => `${i + 1}. *${r.riderName}* (${r.teamName ?? "?"})`).join("\n");
    const url = race.eventSlug ? `${APP_URL}/races/road/${race.eventSlug}` : APP_URL;

    const prompt = `Short WhatsApp results post for ${race.eventName ?? race.name}.

Podium:
${podium}

Max 100 words. Lead with winner's name in bold + 🏆. Add one punchy insight about the race.
End with updated rankings link: ${url}`;

    const text = await generate(prompt);
    await sendToWA(text);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const handlers: Record<string, () => Promise<void>> = {
  news: postNews,
  preview: postPreview,
  raceday: postRaceDay,
  results: postResults,
};

const handler = handlers[mode];
if (!handler && mode !== "breaking") { console.error(`Unknown mode: ${mode}. Use: news|preview|raceday|results|breaking`); process.exit(1); }

if (handler) handler().catch(err => { console.error(err); process.exit(1); });

// ── Mode: BREAKING — urgent news (injury/withdrawal/upset) ───────────────────

const BREAKING_CACHE = "./data/wa-breaking-posted.json";

function loadPosted(): Set<string> {
  try { return new Set(JSON.parse(readFileSync(BREAKING_CACHE, "utf-8"))); }
  catch { return new Set(); }
}

function markPosted(url: string) {
  const { writeFileSync } = require("fs");
  const set = loadPosted(); set.add(url);
  writeFileSync(BREAKING_CACHE, JSON.stringify([...set]));
}

const BREAKING_KEYWORDS = [
  "withdraw", "abandon", "abandon", "sick", "ill", "injur", "crash", "surgery",
  "out of", "scratched", "DNS", "DNF", "not start", "pulled out", "forced to",
  "skade", "sjuk", // swedish
];

function isBreaking(item: any): boolean {
  const text = (item.title + " " + (item.summary ?? "")).toLowerCase();
  if (BREAKING_KEYWORDS.some(k => text.includes(k))) return true;
  if (item.sentiment !== undefined && item.sentiment < -0.3) return true;
  return false;
}

async function postBreaking() {
  const intel = loadTodayIntel();
  const upcoming = await getUpcomingRaces(-1, 14);
  const upcomingNames = upcoming.map(r => (r.eventName ?? r.name).toLowerCase().split(" ")[0]);
  const posted = loadPosted();

  const urgent = intel.filter(item => {
    if (posted.has(item.url)) return false;
    if (!isBreaking(item)) return false;
    // Only fire if related to an upcoming race or well-known rider
    const text = (item.title + " " + (item.subject ?? "")).toLowerCase();
    return upcomingNames.some(n => text.includes(n)) || item.type === "rider";
  });

  if (urgent.length === 0) { console.log("No breaking news"); return; }

  for (const item of urgent.slice(0, 2)) {
    const relatedRace = upcoming.find(r => r.eventSlug &&
      (item.title + (item.subject ?? "")).toLowerCase()
        .includes((r.eventName ?? r.name).toLowerCase().split(" ")[0])
    );
    const raceLink = relatedRace?.eventSlug
      ? `\n👉 ${APP_URL}/races/road/${relatedRace.eventSlug}`
      : "";

    const prompt = `You write urgent cycling news alerts for WhatsApp (Pro Cycling Predictor group).
Write a short, punchy breaking news message (max 80 words) about this:

Headline: ${item.title}
Source: ${item.source_name ?? item.source}

Use ⚠️ emoji to open. *Bold* the rider/race name. End with "via ${item.source_name ?? item.source}".
Say what it means for upcoming races if relevant.
${raceLink ? `End with: ${raceLink}` : "Do NOT add any link."}
No hashtags.`;

    const text = await generate(prompt);
    await sendToWA(text);
    markPosted(item.url);
  }
}

if (mode === "breaking") {
  postBreaking().catch(err => { console.error(err); process.exit(1); });
}
