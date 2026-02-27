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

  const predictionsText = race.topPredictions.slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.riderName} — ${(p.winProbability * 100).toFixed(1)}%`)
    .join("\n");

  const followedText = race.followedRiders.length > 0
    ? race.followedRiders.map(r => {
        if (race.messageType === "result" && r.actualPosition != null) {
          return `${r.name} — finished ${r.actualPosition}${r.predictedPosition ? ` (predicted ${r.predictedPosition})` : ""}`;
        }
        return r.predictedPosition ? `${r.name} — predicted ${r.predictedPosition}` : r.name;
      }).join("\n")
    : "None";

  const newsText = race.recentNews.slice(0, 3)
    .map(n => `- ${n.title}`)
    .join("\n") || "No recent news";

  const previousMessages = userMemory
    ? `\nPREVIOUS MESSAGES TO THIS USER:\n${userMemory}\n` : "";

  const typeInstructions: Record<MessageType, string> = {
    preview: `Write a race PREVIEW message (T-2 days).
- Open with what makes this race special — one punchy sentence
- Give your 5 predictions with brief reasoning for the top 2-3
- Highlight the user's followed riders specifically and where you see them
- End with the URL on its own line (no label)
- Length: 120-180 words`,

    breaking: `Write a SHORT BREAKING NEWS message about a development for this race.
- One key development from the news items below
- React like a fan would — "bad news", "this changes things", etc.
- Keep it under 60 words
- End with the URL`,

    raceday: `Write a RACE DAY morning message.
- Short and punchy — this is race morning
- One key insight or angle for today
- Mention start time if known
- Max 50 words
- End with the URL`,

    result: `Write a RESULTS message after the race.
- Lead with who won and how — one vivid sentence
- Then cover the user's followed riders specifically
- Reference your pre-race prediction if relevant ("we had them top 3 — delivered" or "our model missed this one")
- Conversational, fan-to-fan
- End with the URL
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
- Write like a knowledgeable cycling fan texting a friend
- Use cycling vocabulary naturally (rouleur, puncheur, holeshot for MTB, GC battle etc.)
- Have opinions — "we like X here", "this suits Y perfectly"
- Acknowledge uncertainty — "our model says X but this is cycling"
- No corporate language. No "Hi [name]!" openers. No excessive emoji.
- Avoid Americanisms like "awesome", "your guys", "super". Understated European fan tone.
- Contractions OK. Dry wit OK. Genuine enthusiasm OK — just not performative.
- ${isMTB ? "For MTB: emphasise course conditions, first lap importance, top 3 only (it's chaotic)" : "For road: emphasise terrain, tactics, weather impact"}
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
