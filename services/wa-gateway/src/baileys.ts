import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type AnyMessageContent,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";

const CREDS_DIR = process.env.WA_CREDS_DIR ?? "/data/creds";

let sock: ReturnType<typeof makeWASocket> | null = null;
let connected = false;
let connectTime: Date | null = null;

export function getStatus() {
  return {
    connected,
    uptime: connectTime
      ? Math.floor((Date.now() - connectTime.getTime()) / 1000)
      : 0,
  };
}

export async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(CREDS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }) as any,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      connected = true;
      connectTime = new Date();
      console.log("✅ WhatsApp connected");
    }

    if (connection === "close") {
      connected = false;
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log(`Connection closed (code ${code})`);

      if (code === DisconnectReason.loggedOut) {
        console.error("❌ Logged out — re-pair required. Exiting so Fly restarts.");
        process.exit(1);
      }

      console.log("Reconnecting in 5s...");
      setTimeout(connect, 5000);
    }
  });
}

function resolveJid(to: string): string {
  // Already a JID
  if (to.includes("@")) return to;
  // Phone number → personal JID
  return to.replace(/^\+/, "") + "@s.whatsapp.net";
}

export async function send(
  to: string,
  content: AnyMessageContent
): Promise<void> {
  if (!sock || !connected) throw new Error("Not connected to WhatsApp");
  const jid = resolveJid(to);
  await sock.sendMessage(jid, content);
}

export async function requestPairing(phone: string): Promise<string> {
  if (!sock) throw new Error("Socket not initialized");
  const code = await sock.requestPairingCode(phone.replace(/^\+/, ""));
  return code.match(/.{1,4}/g)!.join("-");
}
