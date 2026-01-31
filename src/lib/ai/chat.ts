/**
 * AI Chat Handler
 *
 * Handles premium AI chat sessions for race analysis
 * Uses Gemini to provide insights based on predictions, rumours, and rider data.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================================
// TYPES
// ============================================================================

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatContext {
  raceId?: string;
  raceName?: string;
  raceDate?: string;
  raceProfile?: string;
  riderId?: string;
  riderName?: string;
  predictions?: Array<{
    riderName: string;
    winProbability: number;
    reasoning: string;
  }>;
  rumours?: Array<{
    riderName: string;
    sentiment: number;
    summary: string;
  }>;
}

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
// CHAT SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(context: ChatContext): string {
  let prompt = `You are an expert cycling analyst assistant. You help users understand race predictions, rider performance, and cycling strategy.

You have access to our prediction system which uses:
- TrueSkill-based ELO ratings (Bayesian skill estimation)
- Recent form analysis (last 90 days, weighted)
- Race profile affinity (flat, hilly, mountain, TT)
- Community intel (tips from users, max 5% impact)

Always be helpful, accurate, and provide insights based on the data available. If you don't have specific information, say so.

`;

  if (context.raceName) {
    prompt += `\nCURRENT CONTEXT:
Race: ${context.raceName}
Date: ${context.raceDate || "Unknown"}
Profile: ${context.raceProfile || "Unknown"}
`;
  }

  if (context.riderName) {
    prompt += `\nFocused Rider: ${context.riderName}\n`;
  }

  if (context.predictions && context.predictions.length > 0) {
    prompt += `\nTOP PREDICTIONS:
${context.predictions
  .slice(0, 10)
  .map(
    (p, i) =>
      `${i + 1}. ${p.riderName}: ${(p.winProbability * 100).toFixed(1)}% win chance
   Reasoning: ${p.reasoning}`
  )
  .join("\n")}
`;
  }

  if (context.rumours && context.rumours.length > 0) {
    prompt += `\nCOMMUNITY INTEL:
${context.rumours
  .map(
    (r) =>
      `- ${r.riderName}: ${r.sentiment > 0 ? "Positive" : r.sentiment < 0 ? "Negative" : "Neutral"} - ${r.summary}`
  )
  .join("\n")}
`;
  }

  return prompt;
}

// ============================================================================
// CHAT HANDLER
// ============================================================================

/**
 * Generate a chat response
 */
export async function generateChatResponse(
  messages: ChatMessage[],
  context: ChatContext,
  userMessage: string
): Promise<{ response: string; tokenCount: number }> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemPrompt = buildSystemPrompt(context);

    // Build chat history
    const history = messages.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // Start chat with history
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "System context: " + systemPrompt }],
        },
        {
          role: "model",
          parts: [
            {
              text: "Understood. I'm ready to help with cycling analysis and predictions.",
            },
          ],
        },
        ...history,
      ],
    });

    // Send user message
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();

    // Estimate token count (rough approximation)
    const tokenCount = Math.ceil(
      (systemPrompt.length + userMessage.length + response.length) / 4
    );

    return {
      response,
      tokenCount,
    };
  } catch (error) {
    console.error("Error generating chat response:", error);
    throw new Error("Failed to generate response");
  }
}

/**
 * Analyze a race and generate initial insights
 */
export async function analyzeRace(context: ChatContext): Promise<string> {
  if (!context.raceName || !context.predictions?.length) {
    return "I don't have enough information about this race to provide analysis.";
  }

  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Analyze the following cycling race and provide key insights:

Race: ${context.raceName}
Date: ${context.raceDate}
Profile: ${context.raceProfile}

Predictions:
${context.predictions
  .slice(0, 10)
  .map((p) => `- ${p.riderName}: ${(p.winProbability * 100).toFixed(1)}%`)
  .join("\n")}

Community Intel:
${
  context.rumours?.length
    ? context.rumours.map((r) => `- ${r.riderName}: ${r.summary}`).join("\n")
    : "None available"
}

Provide a brief analysis (2-3 paragraphs) covering:
1. The favorites and why they're predicted to do well
2. Any dark horses or value picks
3. Key factors that could influence the race

Be specific and reference the data provided.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error analyzing race:", error);
    return "I encountered an error while analyzing the race. Please try again.";
  }
}

/**
 * Compare two riders
 */
export async function compareRiders(
  rider1: { name: string; elo: number; form: number; specialty: string[] },
  rider2: { name: string; elo: number; form: number; specialty: string[] },
  raceProfile: string
): Promise<string> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Compare these two cyclists for a ${raceProfile} race:

Rider 1: ${rider1.name}
- ELO: ${rider1.elo}
- Recent Form: ${rider1.form > 1 ? "Good" : rider1.form < 1 ? "Poor" : "Average"}
- Specialties: ${rider1.specialty.join(", ") || "All-rounder"}

Rider 2: ${rider2.name}
- ELO: ${rider2.elo}
- Recent Form: ${rider2.form > 1 ? "Good" : rider2.form < 1 ? "Poor" : "Average"}
- Specialties: ${rider2.specialty.join(", ") || "All-rounder"}

Provide a brief comparison (1-2 paragraphs) discussing:
1. How they match up head-to-head
2. Who might have the advantage for this race profile
3. Key differences in their strengths

Be concise and specific.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error comparing riders:", error);
    return "I encountered an error while comparing riders. Please try again.";
  }
}
