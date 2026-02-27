import { NextRequest, NextResponse } from "next/server";
import { db, userTelegram } from "@/lib/db";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  const update = await req.json();

  const message = update?.message;
  if (!message?.text || !message?.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const text = message.text as string;
  const chatId = String(message.chat.id);

  if (text.startsWith("/start ")) {
    const token = text.slice("/start ".length).trim();
    if (!token) {
      return NextResponse.json({ ok: true });
    }

    const [row] = await db
      .select()
      .from(userTelegram)
      .where(eq(userTelegram.connectToken, token))
      .limit(1);

    if (row && !row.connectedAt) {
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
        "Connected! You will now receive personalized race alerts on Pro Cycling Predictor."
      );
    }
  }

  return NextResponse.json({ ok: true });
}
