/**
 * get-pairing-code.ts
 * Links a new Baileys session via phone number pairing code.
 * Run once — waits until connection is fully open before exiting.
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

const SESSION_DIR = path.join(process.env.HOME!, ".openclaw/credentials/whatsapp-channel-poster");
fs.mkdirSync(SESSION_DIR, { recursive: true });

const PHONE = process.argv[2]?.replace(/\D/g, "");
if (!PHONE) {
  console.error("Usage: tsx get-pairing-code.ts <phoneNumber>  e.g. 46707124585");
  process.exit(1);
}

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  let codeRequested = false;

  await new Promise<void>((resolve, reject) => {
    // No timeout — wait as long as needed for the user to enter the code
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr && !codeRequested) {
        codeRequested = true;
        try {
          const code = await sock.requestPairingCode(PHONE);
          const formatted = code.match(/.{1,4}/g)!.join("-");
          console.log(`\n📱 Pairing code for +${PHONE}:\n`);
          console.log(`  ➜  ${formatted}\n`);
          console.log("In WhatsApp Business: Linked Devices → Link a Device → Link with phone number");
          console.log("Waiting for you to enter the code...\n");
        } catch (err) {
          reject(err);
        }
      }

      if (connection === "open") {
        console.log("✅ Session linked successfully! Channel poster is ready.");
        await new Promise(r => setTimeout(r, 1000));
        sock.end(undefined);
        resolve();
      }

      if (connection === "close") {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        console.error(`Connection closed — code: ${code}`);
        if (code === DisconnectReason.loggedOut) {
          reject(new Error("Logged out — try relinking"));
        } else {
          // Might just be a normal close after open
          resolve();
        }
      }
    });
  });
}

// Clear any stale session first
fs.readdirSync(SESSION_DIR).forEach(f => fs.rmSync(path.join(SESSION_DIR, f)));
console.log("Starting fresh session...");

main().then(() => process.exit(0)).catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
