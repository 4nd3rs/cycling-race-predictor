#!/usr/bin/env node
/**
 * Join a WhatsApp group via invite link and print its JID.
 * Usage: node join-wa-group.js <invite-code>
 * Example: node join-wa-group.js JlS0HtRQlMMAqEHgZ7g9dD
 */
const { execSync } = require("child_process");
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers } = require("/Users/amalabs/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/@whiskeysockets/baileys");
const pino = require("/Users/amalabs/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/pino");

const CREDS = "/Users/amalabs/.openclaw/credentials/whatsapp/default";
const inviteCode = process.argv[2];

if (!inviteCode) {
  console.error("Usage: node join-wa-group.js <invite-code>");
  process.exit(1);
}

(async () => {
  console.log("Stopping OpenClaw gateway...");
  try { execSync("openclaw gateway stop", { timeout: 10000 }); } catch (e) {}
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
          // Try to get group info first (check if already member)
          let gid;
          try {
            gid = await sock.groupAcceptInvite(inviteCode);
            console.log(`\n✅ Joined group! JID: ${gid}`);
          } catch (e) {
            if (e.message?.includes("already")) {
              // Already a member - resolve JID from invite
              const info = await sock.groupGetInviteInfo(inviteCode);
              gid = info.id;
              console.log(`\nℹ️  Already a member. JID: ${gid}`);
            } else {
              throw e;
            }
          }
          console.log(`\nMTB_WA_GROUP="${gid}"`);
        } catch (e) {
          console.error("Error:", e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
        await sock.end();
        resolve();
      } else if (connection === "close") {
        clearTimeout(timeout);
        resolve();
      }
    });
  }).catch(e => console.error(e.message));

  console.log("\nRestarting OpenClaw gateway...");
  try { execSync("openclaw gateway start", { timeout: 10000 }); } catch (e) {}
  console.log("Done.");
  process.exit(0);
})();
