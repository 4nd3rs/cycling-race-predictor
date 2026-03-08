/**
 * Standalone pairing script.
 * Run via: node dist/pair.js 46707124585
 * Or locally: npx tsx pair.ts 46707124585
 */
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";

const CREDS_DIR = process.env.WA_CREDS_DIR ?? "/data/creds";
const phone = process.argv[2];

if (!phone) {
  console.error("Usage: node dist/pair.js <phone-without-plus>");
  console.error("Example: node dist/pair.js 46707124585");
  process.exit(1);
}

async function pair() {
  const { state, saveCreds } = await useMultiFileAuthState(CREDS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }) as any,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      try {
        const code = await sock.requestPairingCode(phone);
        const formatted = code.match(/.{1,4}/g)!.join("-");
        console.log(`\n📱 Pairing code for +${phone}: ➜  ${formatted}`);
        console.log(
          "WhatsApp → Linked Devices → Link a Device → Link with phone number\n"
        );
      } catch (err: any) {
        console.error("Pairing code error:", err.message);
      }
    }

    if (connection === "open") {
      console.log("✅ Paired successfully! Credentials saved.");
      console.log("You can now deploy the gateway.");
      process.exit(0);
    }
  });
}

pair().catch((err) => {
  console.error(err);
  process.exit(1);
});
