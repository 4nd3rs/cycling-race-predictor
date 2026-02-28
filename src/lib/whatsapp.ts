const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

if (!FROM_NUMBER) {
  console.warn("TWILIO_WHATSAPP_NUMBER is not set — WhatsApp messages will fail");
}

function twilioAuth() {
  return "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.error("Twilio credentials not configured (ACCOUNT_SID, AUTH_TOKEN, WHATSAPP_NUMBER required)");
    return false;
  }

  const toNormalized = to.startsWith("+") ? to : `+${to}`;

  const body = new URLSearchParams({
    From: `whatsapp:${FROM_NUMBER}`,
    To: `whatsapp:${toNormalized}`,
    Body: text,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => res.text());
    console.error("Twilio sendMessage failed:", res.status, JSON.stringify(err));
    return false;
  }

  return true;
}
