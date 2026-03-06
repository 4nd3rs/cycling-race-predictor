/**
 * wa-kick.ts
 * Temporarily borrows OpenClaw's WhatsApp session to kick a group participant.
 * Connects → kicks → disconnects. OpenClaw auto-reconnects within seconds.
 *
 * Usage: tsx scripts/agents/wa-kick.ts <jid> [groupJid]
 * Example: tsx scripts/agents/wa-kick.ts 46701234567@s.whatsapp.net 120363425402092416@g.us
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as path from "path";
import * as os from "os";

const CREDS_DIR = path.join(os.homedir(), ".openclaw/credentials/whatsapp/default");
const GROUP_JID = process.argv[3] ?? "120363425402092416@g.us";
const TARGET_JID = process.argv[2];

if (!TARGET_JID) {
  console.error("Usage: tsx wa-kick.ts <participantJid> [groupJid]");
  process.exit(1);
}

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(CREDS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`Using Baileys v${version.join(".")}`);
  console.log(`Kicking ${TARGET_JID} from ${GROUP_JID}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: { level: "silent" } as any,
    browser: ["AMA Admin", "Chrome", "1.0"],
    connectTimeoutMs: 15000,
    keepAliveIntervalMs: 5000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 1,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 20000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        clearTimeout(timeout);
        try {
          console.log("✅ Connected — sending kick...");
          const result = await sock.groupParticipantsUpdate(GROUP_JID, [TARGET_JID], "remove");
          console.log("Kick result:", JSON.stringify(result));
          await saveCreds();
        } catch (err: any) {
          console.error("Kick failed:", err.message);
        } finally {
          await sock.logout().catch(() => {});
          sock.end(undefined);
          resolve();
        }
      } else if (connection === "close") {
        clearTimeout(timeout);
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          reject(new Error("Session logged out"));
        } else {
          // Normal close after kick
          resolve();
        }
      }
    });
  });

  console.log("✅ Done. OpenClaw will reconnect automatically.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
