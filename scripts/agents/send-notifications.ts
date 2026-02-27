import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL as string);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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
      const lines: string[] = [];
      lines.push(`<b>${(race.event_name as string).toUpperCase()}</b>`);
      lines.push(`${race.country ? `📍 ${race.country}` : ""} | ${race.event_discipline} | ${race.uci_category || "Race"} | ${race.event_date}`);
      lines.push("");

      // If user follows specific riders
      if (data.riderIds.length > 0) {
        const followedRiders = await sql`
          SELECT r.id, r.name FROM riders r WHERE r.id = ANY(${data.riderIds})
        `;
        const riderNameMap = new Map(followedRiders.map((r: { id: string; name: string }) => [r.id, r.name]));

        lines.push("🏃 <b>Your followed riders in this race:</b>");
        for (const riderId of data.riderIds) {
          const riderName = riderNameMap.get(riderId) || "Unknown";
          // Check if rider has a prediction
          const pred = await sql`
            SELECT predicted_position, win_probability FROM predictions
            WHERE race_id = ${race.race_id} AND rider_id = ${riderId}
            LIMIT 1
          `;
          if (pred.length > 0) {
            const pos = pred[0].predicted_position;
            const wp = pred[0].win_probability ? (parseFloat(pred[0].win_probability as string) * 100).toFixed(1) : "—";
            lines.push(`  • ${riderName} — Predicted #${pos} (${wp}% win)`);
          } else {
            lines.push(`  • ${riderName}`);
          }
        }
        lines.push("");
      }

      // Top prediction
      if (topPredictions.length > 0) {
        lines.push("🏆 <b>Top prediction:</b>");
        const top = topPredictions[0];
        const wp = top.win_probability ? (parseFloat(top.win_probability as string) * 100).toFixed(1) : "—";
        lines.push(`  ${top.rider_name} — ${wp}% win probability`);
        lines.push("");
      }

      // Link
      const raceUrl = `https://procyclingpredictor.com/races/${race.event_discipline}/${race.event_slug}${race.category_slug ? `/${race.category_slug}` : ""}`;
      lines.push(`📊 <a href="${raceUrl}">View full predictions</a>`);

      const message = lines.join("\n");

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would send to user ${userId} (chat ${chatId}):`);
        console.log(`    ${message.split("\n").join("\n    ")}`);
      } else {
        const ok = await sendTelegramMessage(chatId, message);
        console.log(`  ${ok ? "✅" : "❌"} Sent to user ${userId} (chat ${chatId})`);
      }
      totalSent++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ${DRY_RUN ? "Would send" : "Sent"}: ${totalSent} messages`);
  console.log(`  Skipped (no Telegram): ${totalSkipped}`);
}

main().catch(console.error);
