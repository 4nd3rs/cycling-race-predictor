#!/usr/bin/env node
/**
 * Post to WhatsApp Channels (newsletters)
 * Usage: node post-to-whatsapp-channel.js --channel men|women|mtb --text "..." [--image /path/to.png]
 *
 * Stops the OpenClaw gateway, posts, then restarts it.
 */
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage } = require("/Users/amalabs/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/@whiskeysockets/baileys");
const pino = require("/Users/amalabs/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/pino");

const CREDS = "/Users/amalabs/.openclaw/credentials/whatsapp/default";
const CHANNEL_INVITES = {
  men:   "0029Vb7oanx9mrGYbDJJNG45",
  women: "0029VbC2aMEHgZWiUxBIzr2K",
  mtb:   "0029Vb7WC3GCMY0Ithd8YG2b",
};

// Parse args
const args = process.argv.slice(2);
const channelArg = args[args.indexOf("--channel") + 1];
const textArg = args[args.indexOf("--text") + 1];
const imageArg = args.includes("--image") ? args[args.indexOf("--image") + 1] : null;
const allChannels = args.includes("--all");

if (!channelArg && !allChannels) {
  console.error("Usage: node post-to-whatsapp-channel.js --channel men|women|mtb [--all] --text '...' [--image /path]");
  process.exit(1);
}

const targets = allChannels ? Object.keys(CHANNEL_INVITES) : [channelArg];

(async () => {
  console.log("Stopping OpenClaw gateway...");
  try { execSync("openclaw gateway stop", { timeout: 10000 }); } catch (e) { /* ignore */ }
  await new Promise(r => setTimeout(r, 3000));

  console.log("Connecting to WhatsApp...");
  const { state, saveCreds } = await useMultiFileAuthState(CREDS);
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    logger,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 20000);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      console.log("WA connection:", connection);
      if (connection === "open") {
        clearTimeout(timeout);
        try {
          for (const ch of targets) {
            const invite = CHANNEL_INVITES[ch];
            console.log(`Resolving channel: ${ch}...`);
            const info = await sock.getNewsletterInfoWithInvite(`https://whatsapp.com/channel/${invite}`);
            console.log(`  JID: ${info.id}, Name: ${info.name}`);

            if (imageArg && fs.existsSync(imageArg)) {
              const imageBuffer = fs.readFileSync(imageArg);
              await sock.sendMessage(info.id, {
                image: imageBuffer,
                caption: textArg || "",
                mimetype: "image/png",
              });
            } else {
              await sock.sendMessage(info.id, { text: textArg || "" });
            }
            console.log(`  Posted to ${ch} ✓`);
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (e) {
          console.error("Post error:", e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
        await sock.end();
        resolve();
      } else if (connection === "close") {
        clearTimeout(timeout);
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === 401) reject(new Error("Auth failed"));
        else resolve();
      }
    });
  }).catch(e => console.error(e.message));

  console.log("Restarting OpenClaw gateway...");
  try { execSync("openclaw gateway start", { timeout: 10000 }); } catch (e) { /* ignore */ }
  console.log("Done.");
  process.exit(0);
})();
