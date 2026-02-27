import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL as string);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER || "+16812710565";
const DRY_RUN = process.argv.includes("--dry-run");

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not set");
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  return res.ok;
}

async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN) return false;
  const normalized = to.startsWith("+") ? to : `+${to}`;
  const body = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM}`,
    To: `whatsapp:${normalized}`,
    Body: text,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  return res.ok;
}

async function main() {
  console.log(`\n🔔 Send Notifications${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  // Find races where date = tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().substring(0, 10);
  console.log(`Looking for races on ${tomorrowStr}...\n`);

  const tomorrowRaces = await sql`
    SELECT r.id as race_id, r.name as race_name, r.discipline, r.uci_category,
           r.race_event_id, r.category_slug,
           re.name as event_name, re.country, re.slug as event_slug, re.discipline as event_discipline, re.date as event_date
    FROM races r
    JOIN race_events re ON r.race_event_id = re.id
    WHERE r.date = ${tomorrowStr}
      AND r.status = 'active'
  `;

  if (tomorrowRaces.length === 0) {
    console.log("No races found for tomorrow.");
    return;
  }

  console.log(`Found ${tomorrowRaces.length} race(s) for tomorrow.\n`);

  let totalSent = 0;
  let totalSkipped = 0;

  for (const race of tomorrowRaces) {
    console.log(`\n📋 ${race.event_name} — ${race.race_name}`);

    // Get startlist rider IDs
    const startlist = await sql`
      SELECT rider_id FROM race_startlist WHERE race_id = ${race.race_id}
    `;
    const startlistRiderIds = startlist.map((s: { rider_id: string }) => s.rider_id);
    console.log(`  Startlist: ${startlistRiderIds.length} riders`);

    if (startlistRiderIds.length === 0 && !race.race_event_id) {
      console.log("  No startlist and no event — skipping.");
      continue;
    }

    // Find users who follow this race event OR any rider on the startlist
    let userFollowsRows: Array<{ user_id: string; follow_type: string; entity_id: string }>;

    if (startlistRiderIds.length > 0) {
      userFollowsRows = await sql`
        SELECT user_id, follow_type, entity_id FROM user_follows
        WHERE (follow_type = 'race_event' AND entity_id = ${race.race_event_id})
           OR (follow_type = 'rider' AND entity_id = ANY(${startlistRiderIds}))
      `;
    } else {
      userFollowsRows = await sql`
        SELECT user_id, follow_type, entity_id FROM user_follows
        WHERE follow_type = 'race_event' AND entity_id = ${race.race_event_id}
      `;
    }

    console.log(`  Matching follows: ${userFollowsRows.length}`);

    // Group by user
    const userMap = new Map<string, { riderIds: string[]; followsEvent: boolean }>();
    for (const row of userFollowsRows) {
      if (!userMap.has(row.user_id)) {
        userMap.set(row.user_id, { riderIds: [], followsEvent: false });
      }
      const entry = userMap.get(row.user_id)!;
      if (row.follow_type === "rider") {
        entry.riderIds.push(row.entity_id);
      } else {
        entry.followsEvent = true;
      }
    }

    if (userMap.size === 0) {
      console.log("  No users to notify.");
      continue;
    }

    // Get top 5 predictions for this race
    const topPredictions = await sql`
      SELECT p.predicted_position, p.win_probability, r.name as rider_name
      FROM predictions p
      JOIN riders r ON p.rider_id = r.id
      WHERE p.race_id = ${race.race_id}
      ORDER BY p.win_probability DESC NULLS LAST
      LIMIT 5
    `;

    // For each user, get telegram info and send
    for (const [userId, data] of userMap) {
      const telegramRows = await sql`
        SELECT telegram_chat_id FROM user_telegram
        WHERE user_id = ${userId} AND telegram_chat_id IS NOT NULL
      `;

      if (telegramRows.length === 0 || !telegramRows[0].telegram_chat_id) {
        totalSkipped++;
        continue;
      }

      const chatId = telegramRows[0].telegram_chat_id as string;

      // Build message
      const raceUrl = `https://procyclingpredictor.com/races/${race.event_discipline}/${race.event_slug}${race.category_slug ? `/${race.category_slug}` : ""}`;

      // Format date: "Saturday 28 Feb"
      const rawDate = race.event_date ? (typeof race.event_date === "string" ? race.event_date : (race.event_date as Date).toISOString()) : null;
      const raceDate = rawDate ? new Date(rawDate.split("T")[0] + "T12:00:00Z") : null;
      const dateStr = raceDate
        ? raceDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
        : "";
      const meta = [dateStr, race.uci_category, race.country].filter(Boolean).join(" · ");

      // Get followed rider predictions
      let followedRiderSummary = "";
      if (data.riderIds.length > 0) {
        const followedPreds = await sql`
          SELECT r.name, p.predicted_position, p.win_probability
          FROM riders r
          LEFT JOIN predictions p ON p.race_id = ${race.race_id} AND p.rider_id = r.id
          WHERE r.id = ANY(${data.riderIds})
          ORDER BY p.win_probability DESC NULLS LAST
        `;
        const ordinal = (n: number) => {
          const s = ["th","st","nd","rd"], v = n % 100;
          return n + (s[(v-20)%10] || s[v] || s[0]);
        };
        const parts = followedPreds.map((r: { name: string; predicted_position: number | null }) =>
          r.predicted_position ? `${r.name} (${ordinal(r.predicted_position)})` : r.name
        );
        if (parts.length > 0) followedRiderSummary = parts.join(", ");
      }

      // Build Telegram message (HTML)
      const tgLines: string[] = [];
      tgLines.push(`<b>${(race.event_name as string).toUpperCase()}</b>`);
      if (meta) tgLines.push(meta);
      tgLines.push("");

      if (topPredictions.length > 0) {
        tgLines.push("<b>Top predictions</b>");
        topPredictions.forEach((p: { rider_name: string; win_probability: string | null }, i: number) => {
          const wp = p.win_probability ? (parseFloat(p.win_probability) * 100).toFixed(1) + "%" : "—";
          tgLines.push(`${i + 1}. ${p.rider_name} — ${wp}`);
        });
        tgLines.push("");
      }

      if (followedRiderSummary) {
        tgLines.push(`You follow: ${followedRiderSummary}`);
        tgLines.push("");
      }

      tgLines.push(`<a href="${raceUrl}">${raceUrl.replace("https://", "")}</a>`);

      const telegramMessage = tgLines.join("\n");

      // WhatsApp: plain text version
      const waLines = tgLines
        .map(l => l.replace(/<[^>]+>/g, ""))
        .join("\n");

      const message = telegramMessage;

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would send to user ${userId} (chat ${chatId}):`);
        console.log(`    ${message.split("\n").join("\n    ")}`);
      } else {
        if (chatId) {
          const ok = await sendTelegramMessage(chatId, message);
          console.log(`  ${ok ? "✅" : "❌"} Telegram → user ${userId}`);
        }
        const waRows = await sql`
          SELECT phone_number FROM user_whatsapp
          WHERE user_id = ${userId} AND phone_number IS NOT NULL AND connected_at IS NOT NULL
          LIMIT 1
        `;
        const waPhone = waRows.length > 0 ? (waRows[0].phone_number as string) : null;
        if (waPhone) {
          const waText = waLines;
          const ok = await sendWhatsAppMessage(waPhone, waText);
          console.log(`  ${ok ? "✅" : "❌"} WhatsApp → ${waPhone}`);
        }
      }
      totalSent++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ${DRY_RUN ? "Would send" : "Sent"}: ${totalSent} messages`);
  console.log(`  Skipped (no Telegram/WhatsApp): ${totalSkipped}`);
}

main().catch(console.error);
