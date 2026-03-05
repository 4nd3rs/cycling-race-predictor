/**
 * post-to-channel.ts
 * Posts a message to a WhatsApp Channel using OpenClaw's existing Baileys session.
 * Usage: tsx scripts/whatsapp/post-to-channel.ts <channelId> "<message>"
 *
 * Channel IDs:
 *   Road: 0029VbC4GfG8aKvQP5l7Vb2F
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import * as path from "path";

const OPENCLAW_SESSION_DIR = path.join(
  process.env.HOME!,
  ".openclaw/credentials/whatsapp-channel-poster"
);

const CHANNELS = {
  road: "0029VbC4GfG8aKvQP5l7Vb2F",
  // mtb: "TODO",
} as const;

async function postToChannel(channelId: string, message: string) {
  const { state, saveCreds } = await useMultiFileAuthState(OPENCLAW_SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 20000);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        clearTimeout(timeout);
        try {
          const jid = `${channelId}@newsletter`;
          await sock.sendMessage(jid, { text: message });
          console.log(`✅ Posted to channel ${channelId}`);
        } catch (err) {
          console.error("Failed to send:", err);
        }
        // Brief wait to ensure message is delivered before disconnect
        await new Promise(r => setTimeout(r, 2000));
        sock.end(undefined);
        resolve();
      } else if (connection === "close") {
        clearTimeout(timeout);
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          reject(new Error("WhatsApp session logged out — relink OpenClaw WhatsApp"));
        } else {
          reject(new Error(`Connection closed: ${code}`));
        }
      }
    });
  });
}

// ── CLI entry ──────────────────────────────────────────────────────────────

const [, , channelArg, ...messageParts] = process.argv;
const message = messageParts.join(" ");

if (!channelArg || !message) {
  console.error("Usage: tsx post-to-channel.ts <channelId|road|mtb> <message>");
  process.exit(1);
}

const channelId = CHANNELS[channelArg as keyof typeof CHANNELS] ?? channelArg;

postToChannel(channelId, message)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
