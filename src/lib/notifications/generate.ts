import type { UserBriefingPlan, DailyContext, BriefingItem } from "./types";
import { racePageUrl } from "./deep-links";

// ── Prompt building ─────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  if (last === last.toUpperCase() || parts[0] === parts[0].toUpperCase()) {
    const firstName = parts[parts.length - 1];
    const lastName = parts.slice(0, -1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    return `${firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()} ${lastName}`;
  }
  return name;
}

function buildBriefingPrompt(plan: UserBriefingPlan, ctx: DailyContext): string {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  const sections: string[] = [];

  // Group items by race for structured output
  const raceGroups = new Map<string, BriefingItem[]>();
  const nonRaceItems: BriefingItem[] = [];

  for (const item of plan.items) {
    if (item.raceId) {
      if (!raceGroups.has(item.raceId)) raceGroups.set(item.raceId, []);
      raceGroups.get(item.raceId)!.push(item);
    } else {
      nonRaceItems.push(item);
    }
  }

  // Build race sections
  for (const [raceId, items] of raceGroups) {
    const race = [...ctx.todayRaces, ...ctx.tomorrowRaces, ...ctx.recentResults]
      .find(r => r.raceId === raceId);
    if (!race) continue;

    const url = racePageUrl(race.discipline, race.eventSlug, race.categorySlug);
    const preds = ctx.predictionsByRace.get(raceId) || [];
    const startlist = ctx.startlistsByRace.get(raceId);
    // Only include predictions for riders confirmed on startlist
    const validPreds = startlist
      ? preds.filter(p => startlist.has(p.riderId))
      : preds;
    const top5Preds = validPreds.slice(0, 5);

    let section = `RACE: ${race.eventName} — ${race.raceName}`;
    if (race.stageNumber) section += ` (Stage ${race.stageNumber})`;
    section += `\nURL: ${url}`;
    section += `\nDate: ${race.date}`;
    if (race.uciCategory) section += ` | Category: ${race.uciCategory}`;
    if (race.country) section += ` | Country: ${race.country}`;

    // Top 5 predictions (startlist-validated)
    if (top5Preds.length > 0) {
      section += "\n\nPredictions (confirmed on startlist):";
      for (const [i, p] of top5Preds.entries()) {
        section += `\n${i + 1}. ${normalizeName(p.riderName)}${p.teamName ? ` (${p.teamName})` : ""} — ${(p.winProbability * 100).toFixed(0)}% win`;
      }
    }

    // Notable absences: riders with predictions but NOT on startlist
    if (startlist && preds.length > 0) {
      const absentPredicted = preds
        .filter(p => !startlist.has(p.riderId) && (p.predictedPosition ?? 999) <= 10)
        .slice(0, 3);
      if (absentPredicted.length > 0) {
        section += "\n\nNotable absences (predicted but NOT on startlist):";
        for (const p of absentPredicted) {
          section += `\n- ${normalizeName(p.riderName)} (was predicted #${p.predictedPosition})`;
        }
      }
    }

    // Results (for evening)
    const results = ctx.resultsByRace.get(raceId);
    if (results && results.length > 0) {
      section += "\n\nActual results:";
      for (const r of results.slice(0, 5)) {
        section += `\n${r.position}. ${normalizeName(r.riderName)}${r.teamName ? ` (${r.teamName})` : ""}`;
      }
    }

    // User's followed riders in this race
    const riderItems = items.filter(i => i.riderId);
    if (riderItems.length > 0) {
      section += "\n\nUser's followed riders in this race:";
      for (const item of riderItems) {
        const name = ctx.riderNames.get(item.riderId!) || "Unknown";
        const data = item.data as Record<string, unknown>;
        let line = `- ${normalizeName(name)}`;

        if (item.contentType === "followed-rider-result") {
          const actual = data.actualPosition as number | null;
          const predicted = data.predictedPosition as number | null;
          if (data.dnf) line += " — DNF";
          else if (data.dns) line += " — DNS";
          else if (actual) line += ` — finished #${actual}`;
          if (predicted) line += ` (predicted #${predicted})`;
        } else if (item.contentType === "followed-rider-racing-today") {
          if (data.predictedPosition) line += ` — predicted #${data.predictedPosition}`;
          if (data.winProbability && (data.winProbability as number) > 0.05) {
            line += ` (${((data.winProbability as number) * 100).toFixed(0)}% win chance)`;
          }
        } else if (item.contentType === "followed-rider-racing-tomorrow") {
          line += " (racing tomorrow)";
        } else if (item.contentType === "followed-rider-startlist-added") {
          line += " — JUST ADDED to startlist";
        } else if (item.contentType === "followed-rider-startlist-removed") {
          line += " — REMOVED from startlist (DNS)";
        } else if (item.contentType === "followed-rider-injury") {
          line += ` — ${data.summary || "injury reported"}`;
        }

        section += `\n${line}`;
      }
    }

    // Followed teams
    const teamItems = items.filter(i => i.contentType === "followed-team-racing-today");
    if (teamItems.length > 0) {
      section += "\n\nUser's followed teams:";
      for (const item of teamItems) {
        const teamName = ctx.teamNames.get(item.teamId!) || "Unknown team";
        const data = item.data as Record<string, unknown>;
        section += `\n- ${teamName} — ${data.riderCount} riders on startlist`;
      }
    }

    sections.push(section);
  }

  // Non-race items (news, rumours)
  const newsItems = nonRaceItems.filter(i => i.contentType === "followed-rider-news");
  if (newsItems.length > 0) {
    let newsSection = "NEWS & INTEL:";
    for (const item of newsItems) {
      const data = item.data as Record<string, unknown>;
      if (data.url) {
        newsSection += `\n- ${data.title}`;
        if (data.summary) newsSection += `: ${data.summary}`;
        newsSection += `\n  Read: ${data.url}`;
      } else if (data.summary) {
        const riderName = item.riderId ? ctx.riderNames.get(item.riderId) : null;
        newsSection += `\n- ${riderName ? normalizeName(riderName) + ": " : ""}${data.summary}`;
      }
    }
    sections.push(newsSection);
  }

  // Determine word budget
  const isAlert = plan.briefingType === "midday-alert";
  const wordBudget = isAlert ? "30-60" : "150-300";
  const briefingLabel = plan.briefingType === "morning" ? "Morning Briefing"
    : plan.briefingType === "evening" ? "Evening Digest"
    : "Breaking Alert";

  return `You are a passionate cycling expert writing a personalized ${briefingLabel} for a specific fan. This is ONE cohesive message covering everything relevant to them today.

DATE: ${today}
MESSAGE TYPE: ${briefingLabel}
WORD BUDGET: ${wordBudget} words

${sections.join("\n\n---\n\n")}

INSTRUCTIONS:
${plan.briefingType === "morning" ? `- Start with: *Your cycling day — ${today}*
- For each race with followed riders: bold the race name, mention predictions, highlight followed riders by name
- Cross-reference: if a rider was predicted highly but is NOT on startlist, flag it as a notable absence
- For "race event only" follows (no personal riders): one sentence max
- End with tomorrow preview if applicable
- Include race URLs on their own lines` : ""}
${plan.briefingType === "evening" ? `- Start with: *Results — ${today}*
- For each race: bold race name, state winner, compare followed rider results vs predictions
- Celebrate good results, commiserate disappointing ones
- News section at the end with article URLs
- Include race URLs on their own lines` : ""}
${plan.briefingType === "midday-alert" ? `- Very short and direct
- State the key fact: what happened and to whom
- Include the race URL if applicable
- No preamble, no fluff` : ""}

CRITICAL RULES:
- ONLY mention riders listed in the data above. Do NOT invent names.
- Every followed rider listed MUST be mentioned by name.
- Include all URLs provided (race pages AND news article links).
- Use *bold* (asterisks) for emphasis. No markdown headers.
- First person: "I predicted", "I had them at #3"
- Dry, understated European tone — knowledgeable but not breathless
- No "Hi!" openers, no corporate language, no hashtags
- URLs go on their own line, not embedded in text

Write ONLY the message text. No preamble. No quotes.`;
}

// ── Gemini call ─────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!res.ok) {
    console.error("[generate] Gemini API error:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface GeneratedMessage {
  html: string;   // For Telegram (HTML bold)
  plain: string;  // For WhatsApp (*bold*)
}

export async function generateBriefing(
  plan: UserBriefingPlan,
  ctx: DailyContext
): Promise<GeneratedMessage | null> {
  if (plan.items.length === 0) return null;

  const prompt = buildBriefingPrompt(plan, ctx);
  const raw = await callGemini(prompt);
  if (!raw) return null;

  // Convert *bold* to HTML <b>bold</b> for Telegram
  const html = raw.replace(/\*([^*]+)\*/g, "<b>$1</b>");

  return { html, plain: raw };
}
