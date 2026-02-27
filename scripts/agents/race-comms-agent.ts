/**
 * Race Communications Agent
 * Generates personalized race message copy using Gemini AI.
 * Reads/writes per-user memory files to maintain continuity.
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || "~", ".openclaw/workspace");
const USERS_DIR = join(WORKSPACE, "memory/users");

export type MessageType = "preview" | "breaking" | "raceday" | "result";

export interface RaceContext {
  eventName: string;
  raceName: string;
  discipline: "road" | "mtb" | "xco" | string;
  uciCategory: string | null;
  country: string | null;
  date: Date | string;
  raceUrl: string;
  topPredictions: Array<{ position: number; riderName: string; winProbability: number }>;
  followedRiders: Array<{ name: string; predictedPosition: number | null; actualPosition?: number | null }>;
  recentNews: Array<{ title: string; summary?: string }>;
  weather?: string;
  messageType: MessageType;
}

export interface UserContext {
  userId: string;
  name?: string;
  commsFrequency: string;
}

function getUserMemoryPath(userId: string): string {
  return join(USERS_DIR, `${userId}.md`);
}

function readUserMemory(userId: string): string {
  const path = getUserMemoryPath(userId);
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  return "";
}

function appendUserMemoryLog(userId: string, raceName: string, messageType: string, summary: string) {
  if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });
  const path = getUserMemoryPath(userId);
  const date = new Date().toISOString().split("T")[0];
  const logLine = `- ${date}: Sent ${messageType} for ${raceName} — ${summary.slice(0, 120)}`;

  if (!existsSync(path)) {
    writeFileSync(path, `# User: ${userId}\n- Frequency: all\n\n## Sent messages log\n${logLine}\n`);
  } else {
    const content = readFileSync(path, "utf-8");
    // Keep last 15 log entries
    const lines = content.split("\n");
    const logIdx = lines.findIndex(l => l.startsWith("## Sent messages log"));
    if (logIdx >= 0) {
      const logLines = lines.slice(logIdx + 1).filter(l => l.startsWith("- "));
      const trimmed = logLines.slice(-14); // keep 14, add 1 new = 15
      const newContent = [...lines.slice(0, logIdx + 1), logLine, ...trimmed, ""].join("\n");
      writeFileSync(path, newContent);
    } else {
      writeFileSync(path, content.trimEnd() + `\n\n## Sent messages log\n${logLine}\n`);
    }
  }
}

function buildPrompt(user: UserContext, race: RaceContext, userMemory: string): string {
  const isMTB = ["mtb", "xco"].includes(race.discipline);
  const isRoad = !isMTB;

  const dateStr = typeof race.date === "string"
    ? new Date(race.date.split("T")[0] + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : race.date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  // Normalize DB name format: "VAN DER POEL Mathieu" → "Mathieu Van Der Poel"
  const normalizeName = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length < 2) return name;
    // Heuristic: if last token looks like a first name (Title case, not ALL CAPS), it's already good
    const last = parts[parts.length - 1];
    if (last === last.toUpperCase() || parts[0] === parts[0].toUpperCase()) {
      // Likely "LASTNAME Firstname" or "ALL CAPS" format — move last word to front
      const firstName = parts[parts.length - 1];
      const lastName = parts.slice(0, -1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      return `${firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()} ${lastName}`;
    }
    return name;
  };

  const predictionsText = race.topPredictions.slice(0, 5)
    .map((p, i) => `${i + 1}. ${normalizeName(p.riderName)} — ${(p.winProbability * 100).toFixed(0)}%`)
    .join("\n");

  const followedText = race.followedRiders.length > 0
    ? race.followedRiders.map(r => {
        if (race.messageType === "result" && r.actualPosition != null) {
          return `${normalizeName(r.name)} — finished ${r.actualPosition}${r.predictedPosition ? ` (predicted ${r.predictedPosition})` : ""}`;
        }
        return r.predictedPosition ? `${normalizeName(r.name)} — predicted ${r.predictedPosition}` : normalizeName(r.name);
      }).join("\n")
    : "None";

  const newsText = race.recentNews.slice(0, 3)
    .map(n => `- ${n.title}`)
    .join("\n") || "No recent news";

  const previousMessages = userMemory
    ? `\nPREVIOUS MESSAGES TO THIS USER:\n${userMemory}\n` : "";

  const typeInstructions: Record<MessageType, string> = {
    preview: `Write a race PREVIEW message (T-2 days).
- One opening sentence on what makes this race special
- If there is relevant recent news (withdrawals, crashes, form updates), mention it briefly before the predictions
- Then a numbered list of predictions. Format each line as:
  1. Firstname Lastname — X% — one short distinctive phrase (vary the phrasing each line, do NOT repeat "I have X at Y%" for every entry)
  Use natural name order (Firstname Lastname, not LASTNAME Firstname)
- If a followed rider appears in the top 5 already, do NOT add a separate sentence about them — they're already listed
- If a followed rider is NOT in the top 5, add one sentence mentioning where they sit
- End with the URL on its own line
- Length: 80-130 words`,

    breaking: `Write a SHORT BREAKING NEWS message about a development for this race.
- Lead with the specific development from the news (withdrawal, injury, weather, team tactics)
- One sentence on how this changes the race picture — who benefits, who is affected
- Keep it under 70 words
- End with the URL`,

    raceday: `Write a RACE DAY morning message.
- Short and punchy — this is race morning
- One key insight or angle for today
- Mention start time if known
- Max 50 words
- End with the URL`,

    result: `Write a RESULTS message after the race.
- One sentence on who won and how
- If there were notable abandonments or incidents, mention them in one line
- Then a numbered results list in this exact format:
  1. Winner Name
  2. Second place
  3. Third place
  (up to 5 if available, use actual positions from followed riders data if provided)
- One line on the followed riders: how they finished vs what I predicted
- End with the URL on its own line
- Length: 60-100 words`,
  };

  return `You are a passionate cycling expert writing personalized race updates for a fan.

RACE: ${race.eventName}
DATE: ${dateStr}
${race.country ? `COUNTRY: ${race.country}` : ""}
${race.uciCategory ? `CATEGORY: ${race.uciCategory}` : ""}
DISCIPLINE: ${isMTB ? "Mountain Bike" : "Road"}
URL: ${race.raceUrl}

TOP PREDICTIONS (our model):
${predictionsText || "No predictions yet"}

USER'S FOLLOWED RIDERS:
${followedText}

RECENT NEWS:
${newsText}
${race.weather ? `\nWEATHER: ${race.weather}` : ""}
${previousMessages}

TONE GUIDE:
- Write like a knowledgeable cycling analyst — authoritative, fan-oriented, think Cyclingnews or VeloNews editorial voice
- Use cycling vocabulary naturally (rouleur, puncheur, holeshot for MTB, parcours, bergs, cobbles etc.)
- Use "I predict", "I have X here", "I'd back X" — first person singular, not "our model" or "the model"
- Dry, understated European tone — confident but not breathless, no hype
- No corporate language. No "Hi [name]!" openers. No excessive emoji. No exclamation mark openers.
- Avoid Americanisms: "awesome", "your guys", "super", "nailed it", "Right,"
- Short punchy sentences for race day/results; fuller analytical writing for previews
- ${isMTB ? "For MTB: emphasise course conditions, first lap importance, top 3 only (it's chaotic)" : "For road: emphasise terrain suitability, tactics, weather impact"}
- IMPORTANT on predictions: the underlying ratings use ELO/form and do NOT account for race profile. Cross-reference with news and terrain. If a rider ranks highly but doesn't suit the parcours, flag it briefly ("I have X highly rated but this terrain may not suit him"). Elevate riders from the news who have a clear edge for this specific race.
- DO NOT repeat information from previous messages

MESSAGE TYPE: ${typeInstructions[race.messageType]}

Write ONLY the message text. No preamble. No quotes. No subject line.
Start directly with the content. End with the URL on its own line.`;
}

export async function generateRaceMessage(
  user: UserContext,
  race: RaceContext
): Promise<{ message: string; plainText: string } | null> {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set");
    return null;
  }

  const userMemory = readUserMemory(user.userId);
  const prompt = buildPrompt(user, race, userMemory);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!res.ok) {
    console.error("Gemini API error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!raw) return null;

  // Telegram version: bold the first line
  const lines = raw.split("\n");
  const telegramLines = lines.map((l, i) => (i === 0 && l.trim() ? `<b>${l.trim()}</b>` : l));
  const telegramMessage = telegramLines.join("\n");

  // Log to user memory
  appendUserMemoryLog(user.userId, race.eventName, race.messageType, raw.slice(0, 120));

  return {
    message: telegramMessage,
    plainText: raw,
  };
}
