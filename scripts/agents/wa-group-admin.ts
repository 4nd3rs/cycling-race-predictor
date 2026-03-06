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
import { eq, isNull, lt, and } from "drizzle-orm";

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
    const res = await fetch(`${OPENCLAW_GATEWAY}/tools/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GATEWAY_TOKEN}` },
      body: JSON.stringify({
        tool: "message",
        args: { action: "send", channel: "whatsapp", target: phone, message },
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function kickMember(jid: string): Promise<boolean> {
  if (dryRun) {
    console.log(`  🚫 DRY RUN KICK: ${jid}`);
    return true;
  }
  try {
    const { execSync } = await import("child_process");
    const scriptPath = new URL("./wa-kick.ts", import.meta.url).pathname;
    const result = execSync(
      `node_modules/.bin/tsx "${scriptPath}" "${jid}" "${WA_GROUP_JID}"`,
      { cwd: process.cwd(), timeout: 30000, encoding: "utf-8" }
    );
    console.log(`  🚫 Kicked ${jid}:`, result.trim());
    // Wait for OpenClaw to reconnect
    await new Promise(r => setTimeout(r, 5000));
    return true;
  } catch (err: any) {
    console.error(`  ❌ Kick failed for ${jid}:`, err.message ?? err);
    return false;
  }
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
  console.log(`🔍 Running WA group admin check${dryRun ? " (DRY RUN)" : ""}...`);

  // Get all known group members
  const members = await db.select().from(waGroupMembers).where(isNull(waGroupMembers.kickedAt));
  console.log(`📋 ${members.length} active tracked members`);

  // Get all registered phones
  const registered = await db.select({ phone: userWhatsapp.phoneNumber }).from(userWhatsapp);
  const registeredPhones = new Set(registered.map(r => r.phone?.replace(/^\+/, "") ?? ""));

  let warned = 0, kicked = 0, ok = 0, skipped = 0;

  for (const member of members) {
    const memberPhone = member.phoneNumber?.replace(/^\+/, "") ?? member.jid.replace("@s.whatsapp.net", "");
    const isRegistered = registeredPhones.has(memberPhone);

    if (isRegistered || member.isAdmin) {
      ok++;
      continue;
    }

    // Not registered — check if we should warn or kick
    const joinedAt = member.joinedAt ?? member.createdAt;
    const daysInGroup = daysDiff(new Date(joinedAt));
    const firstWarnedAt = member.firstWarnedAt ? new Date(member.firstWarnedAt) : null;
    const daysSinceFirstWarning = firstWarnedAt ? daysDiff(firstWarnedAt) : 0;

    console.log(`⚠️  Unregistered: ${member.phoneNumber ?? member.jid} | warnings: ${member.warningCount} | days in group: ${daysInGroup.toFixed(1)}`);

    // Kick if: 2+ warnings AND 3+ days since first warning
    if (member.warningCount >= 2 && firstWarnedAt && daysSinceFirstWarning >= 3) {
      console.log(`  🚫 Kicking — ${member.warningCount} warnings, ${daysSinceFirstWarning.toFixed(1)} days since first warning`);
      const phone = jidToPhone(member.jid);
      await sendDm(phone, `👋 Your time in the *Pro Cycling Predictor Road* group has ended.

You received ${member.warningCount} reminders to register at ${APP_URL}/profile but haven't done so.

You've been removed from the group. You can re-join anytime by registering and adding your WhatsApp number on your profile page.

No hard feelings — see you on the road! 🚴`);
      await kickMember(member.jid);
      if (!dryRun) {
        await db.update(waGroupMembers)
          .set({ kickedAt: new Date(), updatedAt: new Date() })
          .where(eq(waGroupMembers.id, member.id));
      }
      kicked++;
      continue;
    }

    // Don't warn if joined <24h ago (grace period)
    if (daysInGroup < 1) {
      console.log(`  ⏳ Grace period — joined ${(daysInGroup * 24).toFixed(0)}h ago`);
      skipped++;
      continue;
    }

    // Don't re-warn within 24h of last warning
    if (member.lastWarnedAt && daysDiff(new Date(member.lastWarnedAt)) < 1) {
      console.log(`  ⏳ Already warned recently`);
      skipped++;
      continue;
    }

    // Send warning DM
    const warningNum = member.warningCount + 1;
    const phone = jidToPhone(member.jid);
    const warningMsg = warningNum === 1
      ? `👋 Hey! You've joined the *Pro Cycling Predictor Road* WhatsApp group — welcome!

To stay in the group, please register your account at:
👉 ${APP_URL}/profile

Add your WhatsApp number there and you'll get full access to predictions, results and race intel.

Takes 30 seconds — no hard feelings if you'd rather not, but we'll need to remove unregistered members to keep the group quality high. 🚴`
      : `👋 Reminder — you haven't registered your account yet for the *PCP Road* group.

👉 ${APP_URL}/profile → add your WhatsApp number

This is your final reminder. If you're not registered within 3 days of this message, you'll be removed from the group.`;

    await sendDm(phone, warningMsg);

    if (!dryRun) {
      await db.update(waGroupMembers)
        .set({
          warningCount: warningNum,
          firstWarnedAt: member.firstWarnedAt ?? new Date(),
          lastWarnedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(waGroupMembers.id, member.id));
    }
    warned++;
  }

  console.log(`\n✅ Done: ${ok} registered, ${warned} warned, ${kicked} kicked, ${skipped} skipped`);
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
