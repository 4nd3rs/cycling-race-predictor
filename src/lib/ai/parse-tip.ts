/**
 * Tip Parsing with Gemini AI
 *
 * Uses Gemini 1.5 Flash to parse user-submitted tips into structured data
 * including sentiment analysis, category extraction, and confidence scoring.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedTip {
  sentiment: number; // -1 to 1
  category: TipCategory;
  confidence: number; // 0 to 1
  reasoning: string;
  keyEntities: string[];
  isSpam: boolean;
  suggestedWeight: number; // 0 to 1
}

export type TipCategory =
  | "injury"
  | "form"
  | "motivation"
  | "team_dynamics"
  | "equipment"
  | "other";

// ============================================================================
// GEMINI CLIENT
// ============================================================================

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY environment variable is not set");
    }
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// ============================================================================
// TIP PARSING
// ============================================================================

const TIP_PARSING_PROMPT = `You are an expert cycling analyst. Analyze the following tip about a cyclist and extract structured information.

TIP TEXT:
"""
{tipText}
"""

RIDER NAME: {riderName}
RACE (if any): {raceName}

Analyze this tip and respond with a JSON object containing:

1. "sentiment": A number from -1 to 1
   - -1 = Very negative (injury, illness, poor form, conflict)
   - 0 = Neutral or mixed
   - 1 = Very positive (great form, high motivation, strong preparation)

2. "category": One of: "injury", "form", "motivation", "team_dynamics", "equipment", "other"
   - injury: Physical health issues, crashes, recovery
   - form: Training status, recent performance indicators
   - motivation: Mental state, race priorities, personal factors
   - team_dynamics: Team support, leadership, conflicts
   - equipment: Bike, gear, technical issues
   - other: Anything else

3. "confidence": How confident are you in this analysis (0 to 1)?
   - Consider: specificity of the tip, plausibility, verifiable claims

4. "reasoning": Brief explanation of your analysis (1-2 sentences)

5. "keyEntities": Array of key names, events, or facts mentioned

6. "isSpam": true if this appears to be spam, gibberish, or completely unrelated to cycling

7. "suggestedWeight": How much weight should this tip carry (0 to 1)?
   - Consider: specificity, source indicators, verifiability
   - Higher for specific claims with details
   - Lower for vague rumors or clearly speculative content

Respond ONLY with the JSON object, no other text.`;

/**
 * Parse a tip using Gemini AI
 */
export async function parseTip(
  tipText: string,
  riderName: string,
  raceName?: string
): Promise<ParsedTip> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = TIP_PARSING_PROMPT
      .replace("{tipText}", tipText)
      .replace("{riderName}", riderName)
      .replace("{raceName}", raceName || "Not specified");

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());

    // Validate and normalize the response
    return {
      sentiment: Math.max(-1, Math.min(1, parseFloat(parsed.sentiment) || 0)),
      category: validateCategory(parsed.category),
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || ""),
      keyEntities: Array.isArray(parsed.keyEntities)
        ? parsed.keyEntities.map(String)
        : [],
      isSpam: Boolean(parsed.isSpam),
      suggestedWeight: Math.max(
        0,
        Math.min(1, parseFloat(parsed.suggestedWeight) || 0.5)
      ),
    };
  } catch (error) {
    console.error("Error parsing tip with Gemini:", error);

    // Return a neutral result on error
    return {
      sentiment: 0,
      category: "other",
      confidence: 0.3,
      reasoning: "Failed to parse tip with AI",
      keyEntities: [],
      isSpam: false,
      suggestedWeight: 0.3,
    };
  }
}

function validateCategory(category: string): TipCategory {
  const validCategories: TipCategory[] = [
    "injury",
    "form",
    "motivation",
    "team_dynamics",
    "equipment",
    "other",
  ];
  if (validCategories.includes(category as TipCategory)) {
    return category as TipCategory;
  }
  return "other";
}

// ============================================================================
// WEIGHT CALCULATION
// ============================================================================

/**
 * Calculate the final weight for a tip based on various factors
 */
export function calculateTipWeight(
  parsedTip: ParsedTip,
  userAccuracyScore: number, // 0-1, user's historical accuracy
  corroboratingTips: number, // Number of similar tips from other users
  daysSinceSubmission: number
): number {
  // Base weight from AI suggestion
  let weight = parsedTip.suggestedWeight;

  // User accuracy bonus (0 to 0.3)
  weight += userAccuracyScore * 0.3;

  // Corroboration bonus (0.1 per similar tip, max 0.3)
  weight += Math.min(corroboratingTips * 0.1, 0.3);

  // Category weight multiplier
  const categoryWeights: Record<TipCategory, number> = {
    injury: 1.0, // Injuries are high impact
    form: 0.8,
    motivation: 0.6,
    team_dynamics: 0.5,
    equipment: 0.4,
    other: 0.3,
  };
  weight *= categoryWeights[parsedTip.category];

  // Time decay (half-life of 7 days)
  const timeDecay = Math.pow(0.5, daysSinceSubmission / 7);
  weight *= timeDecay;

  // Cap at 1.0
  return Math.min(weight, 1.0);
}

// ============================================================================
// RUMOUR AGGREGATION
// ============================================================================

interface TipWithWeight {
  sentiment: number;
  weight: number;
}

/**
 * Aggregate multiple tips into a single rumour score
 */
export function aggregateTips(tips: TipWithWeight[]): {
  aggregateScore: number;
  totalWeight: number;
} {
  if (tips.length === 0) {
    return { aggregateScore: 0, totalWeight: 0 };
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const tip of tips) {
    weightedSum += tip.sentiment * tip.weight;
    totalWeight += tip.weight;
  }

  const aggregateScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    aggregateScore: Math.max(-1, Math.min(1, aggregateScore)),
    totalWeight,
  };
}

/**
 * Generate a summary of rumours for display
 */
export async function generateRumourSummary(
  tips: Array<{ tipText: string; sentiment: number; category: TipCategory }>
): Promise<string> {
  if (tips.length === 0) {
    return "No community intel available.";
  }

  if (tips.length === 1) {
    return tips[0].tipText.slice(0, 100);
  }

  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const tipsText = tips
      .map(
        (t, i) =>
          `${i + 1}. [${t.category}] (sentiment: ${t.sentiment.toFixed(2)}) ${t.tipText}`
      )
      .join("\n");

    const prompt = `Summarize the following community tips about a cyclist in 1-2 sentences. Focus on the most important/reliable information:

${tipsText}

Respond with only the summary, no other text.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Error generating rumour summary:", error);
    // Fallback to simple summary
    const avgSentiment =
      tips.reduce((sum, t) => sum + t.sentiment, 0) / tips.length;
    if (avgSentiment > 0.3) {
      return "Generally positive reports from the community.";
    }
    if (avgSentiment < -0.3) {
      return "Some concerning reports from the community.";
    }
    return "Mixed reports from the community.";
  }
}
