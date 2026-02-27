import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { generateRaceMessage, MessageType, RaceContext, UserContext } from './race-comms-agent';

const sql = neon(process.env.DATABASE_URL!);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER!;
const TG_CHAT = '8107517782';
const WA_PHONE = '+46707961967';

async function sendTelegram(text: string) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return res.ok;
}

async function sendWhatsApp(text: string) {
  const body = new URLSearchParams({ From: `whatsapp:${TWILIO_FROM}`, To: `whatsapp:${WA_PHONE}`, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return res.ok;
}

async function main() {
  // Race data
  const topPreds = await sql`
    SELECT p.predicted_position, p.win_probability, r.name as rider_name
    FROM predictions p JOIN riders r ON p.rider_id = r.id
    WHERE p.race_id = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01'
    ORDER BY p.win_probability DESC NULLS LAST LIMIT 5
  `;

  const news = await sql`
    SELECT title FROM race_news
    WHERE race_event_id = (SELECT race_event_id FROM races WHERE id = 'bbd718a5-9a38-4e1b-aaa7-c00b99221b01')
    ORDER BY published_at DESC LIMIT 3
  `;

  const baseCtx = {
    eventName: 'Omloop Het Nieuwsblad 2026',
    raceName: 'Elite Men',
    discipline: 'road',
    uciCategory: '1.Pro',
    country: 'BEL',
    date: '2026-02-27',
    raceUrl: 'https://procyclingpredictor.com/races/road/omloop-het-nieuwsblad-2026/elite-men',
    topPredictions: topPreds.map((p: any) => ({ position: p.predicted_position, riderName: p.rider_name, winProbability: parseFloat(p.win_probability || '0') })),
    followedRiders: [{ name: 'Mathieu van der Poel', predictedPosition: 1 }, { name: 'Tom Pidcock', predictedPosition: 2 }],
    recentNews: news.map((n: any) => ({ title: n.title })),
  };

  const user: UserContext = { userId: 'cccc0c75-6fe3-4cde-b3ca-4b0a301f123e', commsFrequency: 'all' };

  const types: MessageType[] = ['preview', 'breaking', 'raceday', 'result'];

  // For result, add actual positions
  const resultFollowedRiders = [
    { name: 'Mathieu van der Poel', predictedPosition: 1, actualPosition: 1 },
    { name: 'Tom Pidcock', predictedPosition: 2, actualPosition: 3 },
  ];

  for (const type of types) {
    console.log(`\nGenerating ${type}...`);
    const ctx: RaceContext = {
      ...baseCtx,
      messageType: type,
      followedRiders: type === 'result' ? resultFollowedRiders : baseCtx.followedRiders,
    };

    const copy = await generateRaceMessage(user, ctx);
    if (!copy) { console.log('  Failed'); continue; }

    console.log('  Text:', copy.plainText.slice(0, 80) + '...');

    // Send separator first so Anders knows which type it is
    const label = `── ${type.toUpperCase()} ─────────────────────────`;
    await sendTelegram(`<b>${label}</b>`);
    await new Promise(r => setTimeout(r, 500));
    const tgOk = await sendTelegram(copy.message);
    console.log(`  TG: ${tgOk ? '✓' : '✗'}`);

    await new Promise(r => setTimeout(r, 2000)); // space them out
  }

  // Send one WhatsApp (the preview) to test that channel too
  console.log('\nSending preview to WhatsApp...');
  const waCtx: RaceContext = { ...baseCtx, messageType: 'preview', followedRiders: baseCtx.followedRiders };
  const waCopy = await generateRaceMessage(user, waCtx);
  if (waCopy) {
    const ok = await sendWhatsApp(waCopy.plainText);
    console.log(`  WA: ${ok ? '✓' : '✗'}`);
  }

  console.log('\nDone!');
}
main().catch(console.error);
