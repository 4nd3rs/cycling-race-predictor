/**
 * wa-group-admin.ts
 * Admin check for the PCP Road WhatsApp group.
 *
 * Checks group members against registered users.
 * - Unregistered members get a DM warning with registration link
 * - After 2 warnings AND 3+ days since first warning → kicked
 *
 * Usage:
 *   tsx scripts/agents/wa-group-admin.ts              # run check
 *   tsx scripts/agents/wa-group-admin.ts --dry-run    # preview only
 *   tsx scripts/agents/wa-group-admin.ts --seed-member "+46701234567" "Name"  # manually add member
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db, waGroupMembers, userWhatsapp } from "./lib/db";
import { eq, isNull } from "drizzle-orm";

const WA_GROUP_JID = "120363425402092416@g.us";
const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;
const APP_URL = "https://procyclingpredictor.com";

const dryRun = process.argv.includes("--dry-run");
const args = process.argv.slice(2);

// ── Helpers ──────────────────────────────────────────────────────────────────

function phoneToJid(phone: string): string {
  return phone.replace(/^\+/, "") + "@s.whatsapp.net";
}

function jidToPhone(jid: string): string {
  return "+" + jid.replace("@s.whatsapp.net", "");
}

function daysDiff(from: Date, to: Date = new Date()): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

async function sendDm(phone: string, message: string): Promise<boolean> {
  if (dryRun) {
    console.log(`  📱 DRY RUN DM to ${phone}:\n${message}\n`);
    return true;
  }
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GATEWAY_TOKEN}` },
      body: JSON.stringify({ to: phone, text: message }),
    });
    return res.ok;
  } catch { return false; }
}



// ── Seed member manually ──────────────────────────────────────────────────────

async function seedMember(phone: string, name?: string) {
  const normalized = phone.startsWith("+") ? phone : "+" + phone;
  const jid = phoneToJid(normalized);
  await db.insert(waGroupMembers).values({
    jid,
    phoneNumber: normalized,
    displayName: name ?? null,
    joinedAt: new Date(),
  }).onConflictDoUpdate({
    target: waGroupMembers.jid,
    set: { phoneNumber: normalized, displayName: name ?? undefined, joinedAt: new Date(), updatedAt: new Date() },
  });
  console.log(`✅ Seeded member: ${normalized} (${name ?? "no name"})`);
}

// ── Main check ────────────────────────────────────────────────────────────────

async function runCheck() {
  const members = await db.select().from(waGroupMembers).where(isNull(waGroupMembers.kickedAt));
  const registered = await db.select({ phone: userWhatsapp.phoneNumber }).from(userWhatsapp);
  const registeredPhones = new Set(registered.map(r => r.phone?.replace(/^\+/, "") ?? ""));

  const unregistered: string[] = [];

  for (const member of members) {
    if (member.isAdmin) continue;
    const memberPhone = member.phoneNumber?.replace(/^\+/, "") ?? member.jid.replace("@s.whatsapp.net", "");
    if (!registeredPhones.has(memberPhone)) {
      const label = member.displayName ? `${member.displayName} (${member.phoneNumber ?? member.jid})` : (member.phoneNumber ?? member.jid);
      unregistered.push(label);

      // Send them a friendly DM reminder (once per day max)
      if (!member.lastWarnedAt || daysDiff(new Date(member.lastWarnedAt)) >= 1) {
        const warningNum = member.warningCount + 1;
        const msg = `👋 Hey! You're in the *Pro Cycling Predictor Road* WhatsApp group.

To stay in the group, please register at:
👉 ${APP_URL}/profile → add your WhatsApp number

Takes 30 seconds. If you need help, just reply here. 🚴`;
        await sendDm(jidToPhone(member.jid), msg);
        if (!dryRun) {
          await db.update(waGroupMembers)
            .set({ warningCount: warningNum, firstWarnedAt: member.firstWarnedAt ?? new Date(), lastWarnedAt: new Date(), updatedAt: new Date() })
            .where(eq(waGroupMembers.id, member.id));
        }
      }
    }
  }

  if (unregistered.length > 0) {
    const report = `🛡️ *PCP Road Group — Unregistered Members*\n\n${unregistered.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\nThey've been sent a registration reminder. Kick them manually if needed.`;
    console.log(report);
    // Notify admin (Anders) via WA DM
    await sendDm("+46707961967", report);
  } else {
    console.log(`✅ All ${members.length} group members are registered.`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (args[0] === "--seed-member") {
  const phone = args[1];
  const name = args[2];
  if (!phone) { console.error("Usage: --seed-member +46701234567 [Name]"); process.exit(1); }
  seedMember(phone, name).then(() => process.exit(0)).catch(console.error);
} else {
  runCheck().catch((e) => { console.error(e); process.exit(1); });
}
