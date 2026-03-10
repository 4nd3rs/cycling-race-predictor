/**
 * AI-Powered PDF Parser
 *
 * Uses LLMWhisperer for text extraction + Claude Haiku for intelligent parsing.
 * Much more robust than regex - handles any PDF format automatically.
 */

import Anthropic from "@anthropic-ai/sdk";
import { extractPdfText } from "./llmwhisperer";

// Lazy-init Anthropic client
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _anthropic;
}

export interface RaceResult {
  position: number | null;
  bibNumber: number | null;
  name: string;
  category: string;
  team: string | null;
  laps: number | null;
  time: string | null;
  gap: string | null;
  status: "finished" | "dnf" | "dns";
}

export interface ParsedRaceData {
  eventName: string | null;
  date: string | null;
  location: string | null;
  categories: string[];
  results: RaceResult[];
}

const METADATA_PROMPT = `Extract event metadata and list ALL categories from this race results text.

Return JSON:
{
  "eventName": "string or null",
  "date": "YYYY-MM-DD or null",
  "location": "string or null",
  "categories": ["list ALL unique category names exactly as they appear"]
}

Text:
`;

const CATEGORY_PROMPT = `Extract ALL riders from the "{CATEGORY}" category ONLY from this race results text.

Return JSON array with EVERY rider in this category:
[
  {
    "position": number or null,
    "bibNumber": number or null,
    "name": "Rider Name",
    "team": "Team Name or null",
    "laps": number or null,
    "time": "1h23:45.67 or null",
    "gap": "+1:23.45 or null",
    "status": "finished/dnf/dns"
  }
]

Rules:
- Extract EVERY rider in {CATEGORY}, including DNF and DNS
- DNF (Abandons): status="dnf", position=null
- DNS (No Sortits): status="dns", position=null
- Return ONLY the JSON array

Text:
`;

/**
 * Call Claude Haiku with a prompt and return parsed JSON
 */
async function callHaiku<T>(prompt: string): Promise<T | null> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 8192,
    system: "You are a JSON-only response bot. Output ONLY valid JSON, no explanation. Start with { or [.",
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  let jsonStr = textBlock.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  return JSON.parse(jsonStr) as T;
}

/**
 * Parse race results from a PDF URL using AI
 * Uses multiple API calls: 1 for metadata + 1 per category
 */
export async function parseRacePdfWithAI(pdfUrl: string): Promise<ParsedRaceData | null> {
  try {
    // Step 1: Extract text using LLMWhisperer
    const extracted = await extractPdfText(pdfUrl, { mode: "table" });

    if (!extracted || !extracted.text) {
      console.error("[AI-Parser] Failed to extract PDF text");
      return null;
    }

    // Step 2: Get metadata and categories
    const metadata = await callHaiku<{
      eventName: string | null;
      date: string | null;
      location: string | null;
      categories: string[];
    }>(METADATA_PROMPT + extracted.text);

    if (!metadata || !metadata.categories.length) {
      console.error("[AI-Parser] Failed to extract metadata");
      return null;
    }

    // Step 3: Extract results for each category in parallel
    const allResults: RaceResult[] = [];

    const categoryPromises = metadata.categories.map(async (category) => {
      const prompt = CATEGORY_PROMPT.replace(/\{CATEGORY\}/g, category) + extracted.text;

      const results = await callHaiku<Array<Omit<RaceResult, "category">>>(prompt);

      if (results && Array.isArray(results)) {
        return results.map((r) => ({ ...r, category }));
      }
      return [];
    });

    const categoryResults = await Promise.all(categoryPromises);
    for (const results of categoryResults) {
      allResults.push(...results);
    }

    return {
      eventName: metadata.eventName,
      date: metadata.date,
      location: metadata.location,
      categories: metadata.categories,
      results: allResults,
    };
  } catch (error) {
    console.error("[AI-Parser] Error:", error);
    return null;
  }
}