import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { db, races, predictions, riders, raceResults, raceStartlist, riderRumours, teams, riderDisciplineStats } from "./lib/db";
import { eq, and, asc, desc } from "drizzle-orm";

const countryFlags: Record<string, string> = {
  BEL: "🇧🇪", NED: "🇳🇱", FRA: "🇫🇷", ITA: "🇮🇹", ESP: "🇪🇸",
  GBR: "🇬🇧", GER: "🇩🇪", DEU: "🇩🇪", SUI: "🇨🇭", CHE: "🇨🇭",
  AUT: "🇦🇹", DEN: "🇩🇰", NOR: "🇳🇴", SWE: "🇸🇪", USA: "🇺🇸",
  AUS: "🇦🇺", CAN: "🇨🇦", SLO: "🇸🇮", POL: "🇵🇱", CZE: "🇨🇿",
  POR: "🇵🇹", COL: "🇨🇴", ERI: "🇪🇷", RSA: "🇿🇦", LUX: "🇱🇺",
  FIN: "🇫🇮", IRL: "🇮🇪", NZL: "🇳🇿", JPN: "🇯🇵", ECU: "🇪🇨",
  CRO: "🇭🇷", UKR: "🇺🇦", KAZ: "🇰🇿", ETH: "🇪🇹", RWA: "🇷🇼",
  AND: "🇦🇩", BRA: "🇧🇷", ARG: "🇦🇷", MEX: "🇲🇽", CHI: "🇨🇱",
};

function getFlag(code: string | null | undefined): string {
  if (!code) return "🏳️";
  return countryFlags[code.toUpperCase()] ?? "🏳️";
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) i++;
    }
  }
  return args;
}

// Telegram MarkdownV2 requires escaping these characters
function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatGap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return m > 0 ? `${m}:${s}` : `0:${s}`;
}

function makeHashtag(raceName: string): string {
  return raceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

async function getTop3Predictions(raceId: string, discipline: string) {
  const rows = await db
    .select({
      name: riders.name,
      nationality: riders.nationality,
    })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(3);

  if (rows.length > 0) return rows;

  // Fallback: top ELO from startlist
  const fallback = await db
    .select({
      name: riders.name,
      nationality: riders.nationality,
    })
    .from(raceStartlist)
    .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
    .leftJoin(
      riderDisciplineStats,
      and(
        eq(riderDisciplineStats.riderId, riders.id),
        eq(riderDisciplineStats.discipline, discipline)
      )
    )
    .where(eq(raceStartlist.raceId, raceId))
    .orderBy(desc(riderDisciplineStats.currentElo))
    .limit(3);

  return fallback;
}

async function getTop3Results(raceId: string) {
  return db
    .select({
      name: riders.name,
      nationality: riders.nationality,
      position: raceResults.position,
      timeSeconds: raceResults.timeSeconds,
      timeGapSeconds: raceResults.timeGapSeconds,
    })
    .from(raceResults)
    .innerJoin(riders, eq(raceResults.riderId, riders.id))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(asc(raceResults.position))
    .limit(3);
}

async function getIntelSnippet(raceId: string, riderName: string): Promise<string | null> {
  const rows = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(and(eq(riders.name, riderName), eq(riderRumours.raceId, raceId)))
    .limit(1);

  if (rows.length > 0 && rows[0].summary) return rows[0].summary;

  const fallback = await db
    .select({ summary: riderRumours.summary })
    .from(riderRumours)
    .innerJoin(riders, eq(riderRumours.riderId, riders.id))
    .where(eq(riders.name, riderName))
    .orderBy(desc(riderRumours.lastUpdated))
    .limit(1);

  return fallback.length > 0 ? fallback[0].summary : null;
}

async function getStartlistCount(raceId: string): Promise<number> {
  const rows = await db
    .select({ id: raceStartlist.id })
    .from(raceStartlist)
    .where(eq(raceStartlist.raceId, raceId));
  return rows.length;
}

async function sendPhoto(botToken: string, chatId: string, photoPath: string, caption: string): Promise<void> {
  const photoBuffer = readFileSync(photoPath);
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);

  // Build multipart form data manually
  const parts: Buffer[] = [];

  // chat_id
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));

  // parse_mode
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdownV2\r\n`));

  // caption
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));

  // photo file
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="race-graphic.png"\r\nContent-Type: image/png\r\n\r\n`));
  parts.push(photoBuffer);
  parts.push(Buffer.from("\r\n"));

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const result = await response.json() as { ok: boolean; description?: string };
  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }
  console.log("Successfully posted to Telegram");
}

async function buildPreviewCaption(race: typeof races.$inferSelect, raceId: string): Promise<string> {
  const top3 = await getTop3Predictions(raceId, race.discipline);
  const riderCount = await getStartlistCount(raceId);
  const intel = top3.length > 0 ? await getIntelSnippet(raceId, top3[0].name) : null;
  const flag = getFlag(race.country);
  const weekday = formatWeekday(race.date);
  const dateStr = formatDateDisplay(race.date);
  const country = race.country || "TBD";
  const uciCategory = race.uciCategory || race.raceType || "Race";
  const hashtag = makeHashtag(race.name);

  const p1 = top3[0] ? `🥇 ${escapeMd(top3[0].name)} ${getFlag(top3[0].nationality)}` : "";
  const p2 = top3[1] ? `🥈 ${escapeMd(top3[1].name)} ${getFlag(top3[1].nationality)}` : "";
  const p3 = top3[2] ? `🥉 ${escapeMd(top3[2].name)} ${getFlag(top3[2].nationality)}` : "";

  const intelSection = intel
    ? `━━━━━━━━━━━━━━━
🕵️ INTEL
━━━━━━━━━━━━━━━
${escapeMd(intel)}`
    : "";

  return `🏁 RACE PREVIEW

*${escapeMd(race.name)}*
📅 ${escapeMd(weekday)}, ${escapeMd(dateStr)}
${flag} ${escapeMd(country)} · ${escapeMd(uciCategory)} · ${escapeMd(String(riderCount))} riders

━━━━━━━━━━━━━━━
🏆 PREDICTIONS
━━━━━━━━━━━━━━━
${p1}
${p2}
${p3}

${intelSection}

🔮 Full predictions & startlist:
procyclingpredictor\.com

\\#cycling \\#roadcycling \\#procycling \\#${escapeMd(hashtag)}`;
}

async function buildResultCaption(race: typeof races.$inferSelect, raceId: string): Promise<string> {
  const top3 = await getTop3Results(raceId);
  const flag = getFlag(race.country);
  const dateStr = formatDateDisplay(race.date);
  const country = race.country || "TBD";

  const p1Line = top3[0]
    ? `🥇 ${escapeMd(top3[0].name)} ${getFlag(top3[0].nationality)}${top3[0].timeSeconds ? ` — ${escapeMd(formatTime(top3[0].timeSeconds))}` : ""}`
    : "";
  const p2Line = top3[1]
    ? `🥈 ${escapeMd(top3[1].name)} ${getFlag(top3[1].nationality)}${top3[1].timeGapSeconds ? ` \\+${escapeMd(formatGap(top3[1].timeGapSeconds))}` : ""}`
    : "";
  const p3Line = top3[2]
    ? `🥉 ${escapeMd(top3[2].name)} ${getFlag(top3[2].nationality)}${top3[2].timeGapSeconds ? ` \\+${escapeMd(formatGap(top3[2].timeGapSeconds))}` : ""}`
    : "";

  // Check if we predicted the winner
  const predictedTop = await db
    .select({ name: riders.name })
    .from(predictions)
    .innerJoin(riders, eq(predictions.riderId, riders.id))
    .where(eq(predictions.raceId, raceId))
    .orderBy(asc(predictions.predictedPosition))
    .limit(1);

  let callItLine = "";
  if (predictedTop.length > 0 && top3.length > 0) {
    if (predictedTop[0].name === top3[0].name) {
      callItLine = "✅ We called it\\! Our AI predicted the winner\\.";
    } else {
      callItLine = `🤔 Surprised\\! We predicted ${escapeMd(predictedTop[0].name)}\\.`;
    }
  }

  return `🏆 RACE RESULT

*${escapeMd(race.name)}*
📅 ${escapeMd(dateStr)} · ${flag} ${escapeMd(country)}

━━━━━━━━━━━━━━━
🎯 FINAL PODIUM
━━━━━━━━━━━━━━━
${p1Line}
${p2Line}
${p3Line}

${callItLine}

📊 Updated rankings & ELO:
procyclingpredictor\.com

\\#cycling \\#roadcycling \\#procycling`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceId = args["race-id"];
  const type = args["type"] as "preview" | "result";
  const channel = args["channel"] || process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!raceId || !type) {
    console.error("Usage: tsx scripts/agents/post-to-telegram.ts --race-id <uuid> --type <preview|result> [--channel <id>]");
    process.exit(1);
  }

  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    process.exit(1);
  }

  if (!channel) {
    console.error("No channel specified. Use --channel or set TELEGRAM_CHANNEL_ID");
    process.exit(1);
  }

  // Fetch race
  const [race] = await db.select().from(races).where(eq(races.id, raceId)).limit(1);
  if (!race) {
    console.error(`Race not found: ${raceId}`);
    process.exit(1);
  }

  // Step 1: Generate graphic
  console.log(`Generating ${type} graphic for: ${race.name}...`);
  const graphicOutput = execSync(
    `node_modules/.bin/tsx scripts/agents/generate-race-graphic.ts --race-id ${raceId} --type ${type}`,
    { encoding: "utf-8", cwd: process.cwd() }
  ).trim();

  const imagePath = graphicOutput.split("\n").pop()!.trim();
  console.log(`Graphic saved to: ${imagePath}`);

  // Step 2: Build caption
  const caption =
    type === "preview"
      ? await buildPreviewCaption(race, raceId)
      : await buildResultCaption(race, raceId);

  // Step 3: Post to Telegram
  console.log(`Posting to Telegram channel: ${channel}...`);
  await sendPhoto(botToken, channel, imagePath, caption);

  console.log(`✅ Successfully posted ${type} for ${race.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
