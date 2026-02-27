import { config } from "dotenv";
config({ path: ".env.local" });

import { db, riders, riderRumours } from "./lib/db";
import { notifyRiderFollowers } from "./lib/notify-followers";
import { eq, ilike } from "drizzle-orm";

interface NewsItem {
  title: string;
  snippet: string;
  source: string;
  url: string;
  date?: string;
}

interface GossipInput {
  riderName: string;
  riderId?: string;
  news: NewsItem[];
}

type RumourType = "injury" | "form" | "transfer" | "team_dynamics" | "other";

async function readStdin(): Promise<GossipInput[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return [];

  // Strip non-JSON lines (e.g. dotenvx verbose output) — keep only lines starting with [ or {
  const jsonLines = raw
    .split("\n")
    .filter((line) => line.trimStart().startsWith("[") || line.trimStart().startsWith("{"));
  const cleaned = jsonLines.join("\n").trim();
  if (!cleaned) return [];

  // Try parsing the cleaned content as a single JSON value first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      // Flatten in case a single line contained an array (from piped scripts)
      return parsed.flat() as GossipInput[];
    }
    return [parsed];
  } catch {
    // NDJSON fallback — each line may be a JSON object or array
  }

  const items: GossipInput[] = [];
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const val = JSON.parse(trimmed);
      if (Array.isArray(val)) {
        items.push(...(val as GossipInput[]));
      } else {
        items.push(val as GossipInput);
      }
    } catch {
      console.error(`Skipping invalid JSON line: ${trimmed.substring(0, 80)}`);
    }
  }
  return items;
}

function classifyNews(news: NewsItem[]): { type: RumourType; sentiment: number } {
  const text = news.map((n) => `${n.title} ${n.snippet}`).join(" ").toLowerCase();

  // Classify type
  let type: RumourType = "other";
  if (/injur|crash|fracture|broken|surgery|hospital|out for|sidelined|withdraw/.test(text)) {
    type = "injury";
  } else if (/transfer|sign|contract|move|join|leaving|departure/.test(text)) {
    type = "transfer";
  } else if (/form|fitness|training|strong|peak|shape|confident|ready|dominant/.test(text)) {
    type = "form";
  } else if (/team.*dynamic|leader|domestique|conflict|tension|support|captain/.test(text)) {
    type = "team_dynamics";
  }

  // Compute sentiment
  const positiveWords = /win|strong|peak|excellent|dominant|confident|great|improve|recover|return|ready|fast|power|success/g;
  const negativeWords = /injur|crash|fracture|broken|surgery|hospital|withdraw|struggle|poor|disappoint|sick|illness|doubt|concern|problem|abandon|dns|dnf/g;

  const positiveCount = (text.match(positiveWords) || []).length;
  const negativeCount = (text.match(negativeWords) || []).length;
  const total = positiveCount + negativeCount;

  let sentiment = 0;
  if (total > 0) {
    sentiment = Math.round(((positiveCount - negativeCount) / total) * 100) / 100;
  }

  return { type, sentiment };
}

function heuristicSummary(riderName: string, news: NewsItem[], type: RumourType, sentiment: number): string {
  const latestTitle = news[0]?.title || "Recent news";
  const sentimentLabel = sentiment > 0.3 ? "positive" : sentiment < -0.3 ? "concerning" : "mixed";

  switch (type) {
    case "injury":
      return `${riderName}: Injury-related news detected. ${latestTitle}. Overall outlook is ${sentimentLabel}.`;
    case "form":
      return `${riderName}: Form/fitness update. ${latestTitle}. Current signals are ${sentimentLabel}.`;
    case "transfer":
      return `${riderName}: Transfer/team news. ${latestTitle}.`;
    case "team_dynamics":
      return `${riderName}: Team dynamics update. ${latestTitle}.`;
    default:
      return `${riderName}: ${latestTitle}. Sentiment is ${sentimentLabel}.`;
  }
}

async function generateSummary(
  riderName: string,
  news: NewsItem[],
  type: RumourType,
  sentiment: number
): Promise<string> {
  // Try AI summary if API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();

      const newsText = news
        .map((n) => `- ${n.title}: ${n.snippet} (${n.source})`)
        .join("\n");

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Summarize these news items about cyclist ${riderName} in 1-2 sentences. Focus on race performance impact. Type: ${type}, sentiment: ${sentiment}.\n\n${newsText}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        return textBlock.text;
      }
    } catch (err) {
      console.error(`AI summary failed for ${riderName}, using heuristic: ${err}`);
    }
  }

  // Fallback to heuristic summary
  return heuristicSummary(riderName, news, type, sentiment);
}

async function findRider(name: string): Promise<string | null> {
  // Normalize name
  let normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  }
  normalized = normalized
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const rider = await db.query.riders.findFirst({
    where: ilike(riders.name, normalized),
  });

  if (rider) return rider.id;

  // Try accent-stripped
  const stripped = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (stripped !== normalized) {
    const rider2 = await db.query.riders.findFirst({
      where: ilike(riders.name, stripped),
    });
    if (rider2) return rider2.id;
  }

  return null;
}

async function processGossip(
  input: GossipInput
): Promise<"upserted" | "rider_not_found" | "error"> {
  try {
    // Find rider
    let riderId = input.riderId || null;
    if (!riderId) {
      riderId = await findRider(input.riderName);
    }

    if (!riderId) return "rider_not_found";

    // Classify and analyze
    const { type, sentiment } = classifyNews(input.news);

    // Generate summary
    const summary = await generateSummary(input.riderName, input.news, type, sentiment);

    // Check if rumour already exists for this rider (no specific race)
    const existing = await db.query.riderRumours.findFirst({
      where: eq(riderRumours.riderId, riderId),
    });

    if (existing) {
      // Update existing rumour
      await db
        .update(riderRumours)
        .set({
          aggregateScore: String(sentiment),
          tipCount: (existing.tipCount || 0) + input.news.length,
          summary,
          lastUpdated: new Date(),
        })
        .where(eq(riderRumours.id, existing.id));
    } else {
      // Insert new rumour
      await db.insert(riderRumours).values({
        riderId,
        aggregateScore: String(sentiment),
        tipCount: input.news.length,
        summary,
      });
    }

    // Notify followers if sentiment is strongly negative (injury/doubt) or strongly positive
    const sentimentNum = parseFloat(String(sentiment));
    if (Math.abs(sentimentNum) >= 0.4) {
      try {
        const riderRow = await db.query.riders.findFirst({ where: (r, { eq }) => eq(r.id, riderId!) });
        if (riderRow) {
          const isNegative = sentimentNum < 0;
          const emoji = isNegative ? "⚠️" : "📈";
          const label = isNegative ? "Negative intel detected" : "Positive form update";
          const msg = [
            `${emoji} <b>${label}: ${riderRow.name}</b>`,
            ``,
            summary || `New intel about ${riderRow.name}.`,
            ``,
            `👉 <a href="https://procyclingpredictor.com/riders/${riderId}">View on Pro Cycling Predictor</a>`,
          ].join("\n");
          const notified = await notifyRiderFollowers(riderId!, msg);
          if (notified > 0) console.error(`📨 Notified ${notified} follower(s) of ${riderRow.name} (sentiment: ${sentimentNum.toFixed(2)})`);
        }
      } catch (notifyErr) {
        console.error(`Notification error for ${input.riderName}:`, notifyErr);
      }
    }

    return "upserted";
  } catch (err) {
    console.error(`Error processing gossip for "${input.riderName}": ${err}`);
    return "error";
  }
}

async function main() {
  const items = await readStdin();

  if (items.length === 0) {
    console.log(
      JSON.stringify({
        upserted: 0,
        riderNotFound: 0,
        errors: 0,
        message: "No input received",
      })
    );
    return;
  }

  let upserted = 0;
  let riderNotFound = 0;
  let errors = 0;

  for (const item of items) {
    if (!item.news || item.news.length === 0) continue;
    const result = await processGossip(item);
    if (result === "upserted") upserted++;
    else if (result === "rider_not_found") riderNotFound++;
    else errors++;
  }

  console.log(
    JSON.stringify({
      upserted,
      riderNotFound,
      errors,
      total: items.length,
      message: `${upserted} rider rumours upserted, ${riderNotFound} riders not found, ${errors} errors`,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
