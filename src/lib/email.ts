/**
 * email.ts — Transactional email via Resend
 * Falls back gracefully if RESEND_API_KEY is not set.
 */
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM = process.env.RESEND_FROM ?? "Pro Cycling Predictor <noreply@procyclingpredictor.com>";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping email to", to);
    return false;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) { console.error("[email] Resend error:", error); return false; }
    return true;
  } catch (err) {
    console.error("[email] Failed to send email:", err);
    return false;
  }
}

export function waInviteEmailHtml(name: string | null): string {
  const displayName = name ? `Hi ${name.split(" ")[0]},` : "Hi,";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f2ede6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#16171b;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#c8102e;padding:24px 32px;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.15em;color:#fff;text-transform:uppercase;">Pro Cycling Predictor</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f2ede6;">You're almost in 🚴</p>
          <p style="margin:0 0 24px;font-size:15px;color:#888890;line-height:1.6;">${displayName}<br><br>
            You've registered for the <strong style="color:#f2ede6;">Pro Cycling Predictor Road</strong> WhatsApp group.<br>
            We've sent you a private invite link via WhatsApp — check your messages.
          </p>

          <!-- WA note -->
          <div style="background:#1e1f24;border:1px solid #2a2b30;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#25d366;">📱 Check WhatsApp</p>
            <p style="margin:0;font-size:13px;color:#888890;line-height:1.5;">
              The invite message comes from <strong style="color:#f2ede6;">+46 70 712 45 85</strong>.<br>
              If you don't see it in your main chats, check <strong style="color:#f2ede6;">Message Requests</strong>
              (tap the chat icon → look for a "Requests" tab or banner at the top).
            </p>
          </div>

          <!-- What you'll get -->
          <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#f2ede6;text-transform:uppercase;letter-spacing:0.1em;">What you'll get</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            ${[
              ["🔮", "Race Previews", "Top picks & win % — 48h before every WorldTour race"],
              ["🌅", "Race Day Briefing", "Morning hype + top pick on race day"],
              ["🏆", "Podium Results", "Same evening — top 3 + how our predictions held up"],
              ["🔴", "Breaking News", "Injuries & withdrawals within hours of breaking"],
            ].map(([icon, title, desc]) => `
            <tr>
              <td width="32" valign="top" style="padding:0 0 14px;font-size:20px;">${icon}</td>
              <td style="padding:0 0 14px;">
                <p style="margin:0;font-size:14px;font-weight:600;color:#f2ede6;">${title}</p>
                <p style="margin:2px 0 0;font-size:13px;color:#888890;">${desc}</p>
              </td>
            </tr>`).join("")}
          </table>

          <p style="margin:24px 0 0;font-size:12px;color:#555;">
            You're receiving this because you registered at procyclingpredictor.com.<br>
            <a href="https://procyclingpredictor.com/profile" style="color:#888890;">Manage your account</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="border-top:1px solid #2a2b30;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#555;">
            <a href="https://procyclingpredictor.com" style="color:#888890;text-decoration:none;">procyclingpredictor.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
