const DISCORD_CHANNEL = "1476643255243509912";

export async function postToDiscord(message: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(
      `https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: message }),
      }
    );
  } catch {}
}
