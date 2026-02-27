const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "+16812710565";

function twilioAuth() {
  return "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.error("Twilio credentials not set");
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
