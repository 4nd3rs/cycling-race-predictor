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
exports.getStatus = getStatus;
exports.connect = connect;
exports.send = send;
exports.requestPairing = requestPairing;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino_1 = __importDefault(require("pino"));
const CREDS_DIR = process.env.WA_CREDS_DIR ?? "/data/creds";
let sock = null;
let connected = false;
let connectTime = null;
function getStatus() {
    return {
        connected,
        uptime: connectTime
            ? Math.floor((Date.now() - connectTime.getTime()) / 1000)
            : 0,
    };
}
async function connect() {
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(CREDS_DIR);
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    sock = (0, baileys_1.default)({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: (0, pino_1.default)({ level: "silent" }),
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
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed (code ${code})`);
            if (code === baileys_1.DisconnectReason.loggedOut) {
                console.error("❌ Logged out — re-pair required. Exiting so Fly restarts.");
                process.exit(1);
            }
            console.log("Reconnecting in 5s...");
            setTimeout(connect, 5000);
        }
    });
}
function resolveJid(to) {
    // Already a JID
    if (to.includes("@"))
        return to;
    // Phone number → personal JID
    return to.replace(/^\+/, "") + "@s.whatsapp.net";
}
async function send(to, content) {
    if (!sock || !connected)
        throw new Error("Not connected to WhatsApp");
    const jid = resolveJid(to);
    await sock.sendMessage(jid, content);
}
async function requestPairing(phone) {
    if (!sock)
        throw new Error("Socket not initialized");
    const code = await sock.requestPairingCode(phone.replace(/^\+/, ""));
    return code.match(/.{1,4}/g).join("-");
}
