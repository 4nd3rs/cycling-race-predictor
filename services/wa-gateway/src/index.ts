import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { connect, getStatus, send, requestPairing } from "./baileys.js";

const app = new Hono();
const TOKEN = process.env.WA_GATEWAY_TOKEN;
const startedAt = Date.now();

// Auth middleware (health is public)
app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const auth = c.req.header("Authorization");
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

app.get("/health", (c) => {
  const status = getStatus();
  return c.json({
    connected: status.connected,
    uptime: status.uptime,
    serverUptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

app.post("/send", async (c) => {
  const body = await c.req.json();
  const { to, text, image, caption } = body;

  if (!to) return c.json({ error: "missing 'to'" }, 400);
  if (!text && !image) return c.json({ error: "missing 'text' or 'image'" }, 400);

  try {
    if (image) {
      const imageBuffer = Buffer.from(image, "base64");
      await send(to, { image: imageBuffer, caption: caption ?? "" });
    } else {
      await send(to, { text });
    }
    return c.json({ ok: true });
  } catch (err: any) {
    console.error("Send error:", err.message);
    return c.json({ error: err.message }, 500);
  }
});

app.post("/pair", async (c) => {
  const { phone } = await c.req.json();
  if (!phone) return c.json({ error: "missing 'phone'" }, 400);

  try {
    const code = await requestPairing(phone);
    console.log(`📱 Pairing code: ${code}`);
    return c.json({ code });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

const port = parseInt(process.env.PORT ?? "3000");
console.log(`Starting wa-gateway on port ${port}...`);

connect().catch((err) => {
  console.error("Initial connection failed:", err);
});

serve({ fetch: app.fetch, port });
