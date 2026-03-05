/**
 * channel-daemon.ts
 * Persistent WhatsApp channel poster daemon.
 * Stays connected, listens on a Unix socket for post commands.
 * Start: tsx channel-daemon.ts
 * Post:  echo '{"channel":"road","text":"hello"}' | nc -U /tmp/wa-channel.sock
 */

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";

const SESSION_DIR = path.join(process.env.HOME!, ".openclaw/credentials/whatsapp-channel-poster");
const SOCK_PATH = "/tmp/wa-channel.sock";
const PHONE = "46707124585";

const CHANNELS: Record<string, string> = {
  road: "0029VbC4GfG8aKvQP5l7Vb2F",
  // mtb: "TODO",
};

fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock: ReturnType<typeof makeWASocket> | null = null;
let isConnected = false;
let codeRequested = false;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !codeRequested) {
      codeRequested = true;
      try {
        const code = await sock!.requestPairingCode(PHONE);
        const formatted = code.match(/.{1,4}/g)!.join("-");
        console.log(`\n📱 Pairing code for +${PHONE}: ➜  ${formatted}`);
        console.log("WhatsApp Business → Linked Devices → Link a Device → Link with phone number\n");
      } catch (err: any) {
        console.error("Pairing code error:", err.message);
      }
    }

    if (connection === "open") {
      isConnected = true;
      codeRequested = false;
      console.log("✅ WhatsApp channel daemon connected");
    }

    if (connection === "close") {
      isConnected = false;
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log(`Connection closed (code ${code}), reconnecting in 5s...`);
      if (code === DisconnectReason.loggedOut) {
        console.error("❌ Logged out — delete session and relink");
        process.exit(1);
      }
      setTimeout(connect, 5000);
    }
  });
}

async function postToChannel(channelId: string, text: string): Promise<string> {
  if (!sock || !isConnected) return "error: not connected";
  try {
    const jid = `${channelId}@newsletter`;
    await sock.sendMessage(jid, { text });
    return "ok";
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

// ── Unix socket server ────────────────────────────────────────────────────────

if (fs.existsSync(SOCK_PATH)) fs.unlinkSync(SOCK_PATH);

const server = net.createServer((client) => {
  let buf = "";
  client.on("data", (d) => (buf += d.toString()));
  client.on("end", async () => {
    try {
      const { channel, text } = JSON.parse(buf.trim());
      const channelId = CHANNELS[channel] ?? channel;
      const result = await postToChannel(channelId, text);
      client.write(result + "\n");
      console.log(`[post] ${channel}: ${result}`);
    } catch (err: any) {
      client.write(`error: ${err.message}\n`);
    }
    client.end();
  });
});

server.listen(SOCK_PATH, () => {
  console.log(`🔌 Listening on ${SOCK_PATH}`);
});

process.on("exit", () => {
  if (fs.existsSync(SOCK_PATH)) fs.unlinkSync(SOCK_PATH);
});

connect();
