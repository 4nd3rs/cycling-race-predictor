import { NextRequest, NextResponse } from "next/server";
import { db, userTelegram } from "@/lib/db";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret token
  const secretToken = req.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update = await req.json();

  const message = update?.message;
  if (!message?.text || !message?.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const text = (message.text as string).trim();
  const chatId = String(message.chat.id);

  if (text.startsWith("/start")) {
    const token = text.startsWith("/start ") ? text.slice("/start ".length).trim() : "";

    if (!token) {
      // No token — guide them to connect via the website
      await sendTelegramMessage(
        chatId,
        [
          "👋 <b>Welcome to Pro Cycling Predictor!</b>",
          "",
          "To connect your account and receive race notifications, go to your profile on the website and click <b>Connect Telegram</b>:",
          "",
          "👉 <a href=\"https://procyclingpredictor.com/profile\">procyclingpredictor.com/profile</a>",
          "",
          "<i>You'll get a personalised link that connects this chat to your account.</i>",
        ].join("\n")
      );
      return NextResponse.json({ ok: true });
    }

    const [row] = await db
      .select()
      .from(userTelegram)
      .where(eq(userTelegram.connectToken, token))
      .limit(1);

    if (!row) {
      await sendTelegramMessage(
        chatId,
        [
          "❌ <b>Link expired or already used.</b>",
          "",
          "Please generate a new connection link from your profile:",
          "👉 <a href=\"https://procyclingpredictor.com/profile\">procyclingpredictor.com/profile</a>",
        ].join("\n")
      );
      return NextResponse.json({ ok: true });
    }

    if (row.connectedAt) {
      await sendTelegramMessage(
        chatId,
        "✅ <b>Your account is already connected!</b>\n\nYou're all set to receive race notifications."
      );
      return NextResponse.json({ ok: true });
    }

    // Connect the account
    await db
      .update(userTelegram)
      .set({
        telegramChatId: chatId,
        connectedAt: new Date(),
        connectToken: null,
      })
      .where(eq(userTelegram.id, row.id));

    await sendTelegramMessage(
      chatId,
      [
        "🎉 <b>Connected! You're all set.</b>",
        "",
        "You'll now receive personalised Telegram alerts from Pro Cycling Predictor — predictions, results, and intel for races and riders you follow.",
        "",
        "👉 <a href=\"https://procyclingpredictor.com\">Start following races & riders</a>",
      ].join("\n")
    );
  }

  return NextResponse.json({ ok: true });
}
