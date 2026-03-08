"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Standalone pairing script.
 * Run via: node dist/pair.js 46707124585
 * Or locally: npx tsx pair.ts 46707124585
 */
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino_1 = __importDefault(require("pino"));
const CREDS_DIR = process.env.WA_CREDS_DIR ?? "/data/creds";
const phone = process.argv[2];
if (!phone) {
    console.error("Usage: node dist/pair.js <phone-without-plus>");
    console.error("Example: node dist/pair.js 46707124585");
    process.exit(1);
}
async function pair() {
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(CREDS_DIR);
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    const sock = (0, baileys_1.default)({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: (0, pino_1.default)({ level: "silent" }),
        markOnlineOnConnect: false,
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, qr }) => {
        if (qr) {
            try {
                const code = await sock.requestPairingCode(phone);
                const formatted = code.match(/.{1,4}/g).join("-");
                console.log(`\n📱 Pairing code for +${phone}: ➜  ${formatted}`);
                console.log("WhatsApp → Linked Devices → Link a Device → Link with phone number\n");
            }
            catch (err) {
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
