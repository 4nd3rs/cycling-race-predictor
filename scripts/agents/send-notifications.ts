/**
 * Race Notifications — full communication arc
 * Run via cron at multiple points:
 *   --type preview    : T-2 days (or --days-ahead N)
 *   --type raceday    : race morning
 *   --type result     : after race finishes
 *   --type breaking   : triggered by news agent
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { generateRaceMessage, MessageType, RaceContext, UserContext } from "./race-comms-agent";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL as string);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER || "+16812710565";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MESSAGE_TYPE: MessageType = (args[args.indexOf("--type") + 1] as MessageType) || "preview";
const DAYS_AHEAD = args.includes("--days-ahead") ? parseInt(args[args.indexOf("--days-ahead") + 1]) : 2;

// Frequency gates per message type
const FREQUENCY_GATES: Record<MessageType, string[]> = {
  preview:  ["all", "key-moments"],
  breaking: ["all", "key-moments"],
  raceday:  ["all"],
  result:   ["all", "key-moments", "race-day-only"],
};

async function sendTelegram(chatId: string, text: string, imagePath?: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  if (imagePath && existsSync(imagePath)) {
    const { FormData, Blob } = await import("node:buffer") as any;
    // Use sendPhoto with caption
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", text);
    form.append("parse_mode", "HTML");
    const buf = readFileSync(imagePath);
    form.append("photo", new Blob([buf], { type: "image/png" }), "card.png");
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form as any });
    if (res.ok) return true;
    // Fallback to text only
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return res.ok;
}

async function sendWhatsApp(to: string, text: string, imagePath?: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN) return false;
  const normalized = to.startsWith("+") ? to : `+${to}`;

  if (imagePath && existsSync(imagePath)) {
    // For WhatsApp images, we need a public URL — for now fall back to text with URL
    // TODO: upload to CDN first when template is available
  }

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

async function alreadySent(userId: string, raceId: string, type: MessageType, channel: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM notification_log
    WHERE user_id = ${userId} AND race_id = ${raceId} AND message_type = ${type} AND channel = ${channel}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function logSent(userId: string, raceId: string, type: MessageType, channel: string) {
  await sql`
    INSERT INTO notification_log (user_id, race_id, message_type, channel)
    VALUES (${userId}, ${raceId}, ${type}, ${channel})
    ON CONFLICT DO NOTHING
  `;
}

async function main() {
  console.log(`\nRace Notifications — type: ${MESSAGE_TYPE}, days ahead: ${DAYS_AHEAD}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + DAYS_AHEAD);
  const targetDateStr = targetDate.toISOString().substring(0, 10);
  console.log(`Target date: ${targetDateStr}\n`);

  const races = await sql`
    SELECT r.id as race_id, r.name as race_name, r.discipline, r.uci_category,
           r.race_event_id, r.category_slug, r.status,
           re.name as event_name, re.country, re.slug as event_slug,
           re.discipline as event_discipline, re.date as event_date
    FROM races r
    JOIN race_events re ON r.race_event_id = re.id
    WHERE r.date::date = ${targetDateStr}::date
      AND r.status = 'active'
  `;

  if (races.length === 0) { console.log("No races found."); return; }
  console.log(`${races.length} race(s) found.\n`);

  let sent = 0, skipped = 0, dupes = 0;

  for (const race of races) {
    console.log(`\n${race.event_name}`);

    // Startlist
    const startlist = await sql`SELECT rider_id FROM race_startlist WHERE race_id = ${race.race_id}`;
    const startlistIds = startlist.map((s: { rider_id: string }) => s.rider_id);

    // Find users to notify
    let followRows: Array<{ user_id: string; follow_type: string; entity_id: string }> = [];
    if (startlistIds.length > 0) {
      followRows = await sql`
        SELECT user_id, follow_type, entity_id FROM user_follows
        WHERE (follow_type = 'race_event' AND entity_id = ${race.race_event_id})
           OR (follow_type = 'rider' AND entity_id = ANY(${startlistIds}))
      `;
    } else {
      followRows = await sql`
        SELECT user_id, follow_type, entity_id FROM user_follows
        WHERE follow_type = 'race_event' AND entity_id = ${race.race_event_id}
      `;
    }

    if (followRows.length === 0) { console.log("  No followers."); continue; }

    // Top 5 predictions
    const topPreds = await sql`
      SELECT p.predicted_position, p.win_probability, r.name as rider_name
      FROM predictions p JOIN riders r ON p.rider_id = r.id
      WHERE p.race_id = ${race.race_id}
      ORDER BY p.win_probability DESC NULLS LAST LIMIT 5
    `;

    // Recent news
    const news = await sql`
      SELECT title FROM race_news
      WHERE race_event_id = ${race.race_event_id}
      ORDER BY published_at DESC LIMIT 3
    `;

    // Group follows by user
    const userMap = new Map<string, { riderIds: string[]; followsEvent: boolean }>();
    for (const row of followRows) {
      if (!userMap.has(row.user_id)) userMap.set(row.user_id, { riderIds: [], followsEvent: false });
      const e = userMap.get(row.user_id)!;
      if (row.follow_type === "rider") e.riderIds.push(row.entity_id);
      else e.followsEvent = true;
    }

    const raceUrl = `https://procyclingpredictor.com/races/${race.event_discipline}/${race.event_slug}${race.category_slug ? `/${race.category_slug}` : ""}`;

    for (const [userId, data] of userMap) {
      // Get user info
      const userRows = await sql`
        SELECT u.id, u.comms_frequency,
          ut.telegram_chat_id, uw.phone_number as whatsapp_phone
        FROM users u
        LEFT JOIN user_telegram ut ON ut.user_id = u.id AND ut.connected_at IS NOT NULL
        LEFT JOIN user_whatsapp uw ON uw.user_id = u.id AND uw.connected_at IS NOT NULL
        WHERE u.id = ${userId}
        LIMIT 1
      `;

      if (userRows.length === 0) { skipped++; continue; }
      const userRow = userRows[0];
      const freq: string = (userRow.comms_frequency as string) || "key-moments";

      // Check frequency gate
      if (!FREQUENCY_GATES[MESSAGE_TYPE].includes(freq)) {
        console.log(`  Skipping user ${userId} (frequency: ${freq})`);
        skipped++;
        continue;
      }

      const hasTelegram = !!userRow.telegram_chat_id;
      const hasWhatsApp = !!userRow.whatsapp_phone;
      if (!hasTelegram && !hasWhatsApp) { skipped++; continue; }

      // Get followed rider predictions
      const followedRiderData = data.riderIds.length > 0 ? await sql`
        SELECT r.name, p.predicted_position, p.win_probability
        FROM riders r
        LEFT JOIN predictions p ON p.race_id = ${race.race_id} AND p.rider_id = r.id
        WHERE r.id = ANY(${data.riderIds})
        ORDER BY p.win_probability DESC NULLS LAST
      ` : [];

      const user: UserContext = { userId, commsFrequency: freq };
      const raceCtx: RaceContext = {
        eventName: race.event_name as string,
        raceName: race.race_name as string,
        discipline: (race.event_discipline || race.discipline) as string,
        uciCategory: race.uci_category as string | null,
        country: race.country as string | null,
        date: race.event_date as string,
        raceUrl,
        topPredictions: topPreds.map((p: any) => ({
          position: p.predicted_position,
          riderName: p.rider_name,
          winProbability: parseFloat(p.win_probability || "0"),
        })),
        followedRiders: followedRiderData.map((r: any) => ({
          name: r.name,
          predictedPosition: r.predicted_position,
        })),
        recentNews: news.map((n: any) => ({ title: n.title })),
        messageType: MESSAGE_TYPE,
      };

      console.log(`  Generating ${MESSAGE_TYPE} for user ${userId}...`);
      const copy = DRY_RUN ? null : await generateRaceMessage(user, raceCtx);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would send ${MESSAGE_TYPE} to user ${userId}`);
        sent++;
        continue;
      }

      if (!copy) { console.log(`  Failed to generate copy`); skipped++; continue; }

      // Send Telegram
      if (hasTelegram) {
        const chatId = userRow.telegram_chat_id as string;
        const dupe = await alreadySent(userId, race.race_id as string, MESSAGE_TYPE, "telegram");
        if (dupe) { console.log(`  Telegram: already sent`); dupes++; }
        else {
          const ok = await sendTelegram(chatId, copy.message);
          console.log(`  ${ok ? "✓" : "✗"} Telegram → ${userId}`);
          if (ok) { await logSent(userId, race.race_id as string, MESSAGE_TYPE, "telegram"); sent++; }
        }
      }

      // Send WhatsApp
      if (hasWhatsApp) {
        const phone = userRow.whatsapp_phone as string;
        const dupe = await alreadySent(userId, race.race_id as string, MESSAGE_TYPE, "whatsapp");
        if (dupe) { console.log(`  WhatsApp: already sent`); dupes++; }
        else {
          const ok = await sendWhatsApp(phone, copy.plainText);
          console.log(`  ${ok ? "✓" : "✗"} WhatsApp → ${phone}`);
          if (ok) { await logSent(userId, race.race_id as string, MESSAGE_TYPE, "whatsapp"); sent++; }
        }
      }
    }
  }

  console.log(`\nDone — sent: ${sent}, skipped: ${skipped}, dupes avoided: ${dupes}`);
}

main().catch(console.error);
