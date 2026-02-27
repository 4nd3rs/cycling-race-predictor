/**
 * Instagram posting agent — publishes feed (1080×1080) or stories (1080×1920) to @procyclingpredictor
 *
 * Usage:
 *   tsx scripts/agents/post-to-instagram.ts --image /path/to/image.png --caption "..." 
 *   tsx scripts/agents/post-to-instagram.ts --event omloop-het-nieuwsblad-2026 --type preview [--stories]
 *   tsx scripts/agents/post-to-instagram.ts --event omloop-het-nieuwsblad-2026 --type results
 *
 * Requires in .env.local:
 *   INSTAGRAM_ACCESS_TOKEN=...
 *   INSTAGRAM_ACCOUNT_ID=17841449538605666
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const isStories = args.includes("--stories");

const ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID!;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IMAGE_HOST = process.env.INSTAGRAM_IMAGE_HOST ?? "https://procyclingpredictor.com";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function igPost(path: string, body: Record<string, string>) {
  const url = `https://graph.instagram.com/v21.0/${path}?access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(`Instagram API error: ${JSON.stringify(data.error)}`);
  return data;
}

async function igGet(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://graph.instagram.com/v21.0/${path}${sep}access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json() as any;
  if (data.error) throw new Error(`Instagram API error: ${JSON.stringify(data.error)}`);
  return data;
}

// ── Upload image to a public URL ──────────────────────────────────────────────
// Instagram requires a publicly accessible image URL for container creation.
// We upload to Vercel Blob or a temp S3 URL, then delete after publish.
async function uploadImageForInstagram(imagePath: string): Promise<string> {
  // Option 1: Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const imageBuffer = require("fs").readFileSync(imagePath);
    const filename = `ig-post-${Date.now()}.png`;
    const blob = await put(filename, imageBuffer, { access: "public", contentType: "image/png" });
    return blob.url;
  }

  // Option 2: GitHub raw CDN — commit to public/ and use raw.githubusercontent.com
  const filename = `ig-${Date.now()}.png`;
  const destPath = join(process.cwd(), "public", filename);
  require("fs").copyFileSync(imagePath, destPath);
  const { execSync } = await import("child_process");
  execSync(`git add public/${filename} && git commit -m "chore: stage IG image ${filename}" && git push`, { stdio: "pipe" });
  const url = `https://raw.githubusercontent.com/4nd3rs/cycling-race-predictor/main/public/${filename}`;
  console.log(`  Hosted at: ${url}`);
  // Wait a moment for GitHub CDN to propagate
  await new Promise(r => setTimeout(r, 8000));
  return url;
}

async function cleanupStagedImage(imageUrl: string) {
  if (imageUrl.includes("vercel-storage") || imageUrl.includes("blob.vercel")) return;
  if (imageUrl.includes("raw.githubusercontent.com")) {
    const filename = imageUrl.split("/").pop()!;
    const localPath = join(process.cwd(), "public", filename);
    const { execSync } = await import("child_process");
    try {
      execSync(`git rm public/${filename} && git commit -m "chore: remove staged IG image" && git push`, { stdio: "pipe" });
    } catch { /* best effort */ }
    if (existsSync(localPath)) unlinkSync(localPath);
    return;
  }
  const filename = imageUrl.split("/").pop()!;
  const localPath = join(process.cwd(), "public", filename);
  if (existsSync(localPath)) unlinkSync(localPath);
}

// ── Generate card if needed ───────────────────────────────────────────────────
async function generateCard(eventSlug: string, type: string, gender: string): Promise<string> {
  const outPath = `/tmp/pcp-ig-${type}-${gender}-${Date.now()}.png`;
  console.log(`Generating ${gender} ${type} card for ${eventSlug}...`);
  const storiesFlag = isStories ? " --stories" : "";
  execSync(
    `node_modules/.bin/tsx scripts/agents/generate-instagram-card.tsx --event ${eventSlug} --type ${type} --gender ${gender}${storiesFlag} --out ${outPath}`,
    { stdio: "inherit" }
  );
  return outPath;
}

// ── Build caption ─────────────────────────────────────────────────────────────
async function buildCaption(eventSlug: string, type: string, gender: string): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);
  const [event] = await sql`SELECT name, date, country, discipline FROM race_events WHERE slug = ${eventSlug}`;
  if (!event) return `Pro Cycling Predictor\n\n#cycling #procycling #predictions`;

  const name = event.name as string;
  const dateStr = event.date ? new Date(String(event.date).split("T")[0] + "T12:00:00Z")
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";

  if (type === "preview") {
    const preds = await sql`
      SELECT r.name AS rider_name, p.win_probability
      FROM predictions p
      JOIN riders r ON r.id = p.rider_id
      JOIN races rc ON rc.id = p.race_id
      JOIN race_events re ON re.id = rc.race_event_id
      WHERE re.slug = ${eventSlug} AND rc.gender = ${gender} AND rc.age_category = 'elite'
        AND p.win_probability IS NOT NULL
      ORDER BY p.win_probability DESC LIMIT 3
    `;
    const predLines = preds.map((p: any, i: number) =>
      `${i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} ${p.rider_name} — ${Math.round(Number(p.win_probability) * 100)}%`
    ).join("\n");

    return [
      `🚴 ${gender === "women" ? "Women's " : ""}Race Preview: ${name}`,
      `📅 ${dateStr}`,
      ``,
      `Our AI predictions:`,
      predLines,
      ``,
      `Full startlist + predictions at procyclingpredictor.com`,
      ``,
      `#cycling #procycling #${name.toLowerCase().replace(/\s+/g, "")} #predictions #roadcycling${gender === "women" ? " #womenscycling" : ""}`,
    ].join("\n");
  } else {
    const results = await sql`
      SELECT r.name AS rider_name, rr.position
      FROM race_results rr
      JOIN riders r ON r.id = rr.rider_id
      JOIN races rc ON rc.id = rr.race_id
      JOIN race_events re ON re.id = rc.race_event_id
      WHERE re.slug = ${eventSlug} AND rc.gender = ${gender}
      ORDER BY rr.position ASC LIMIT 3
    `;
    const podium = results.map((r: any) =>
      `${r.position === 1 ? "🥇" : r.position === 2 ? "🥈" : "🥉"} ${r.rider_name}`
    ).join("\n");

    return [
      `🏁 ${gender === "women" ? "Women's " : ""}Results: ${name}`,
      ``,
      podium,
      ``,
      `More results + analysis at procyclingpredictor.com`,
      ``,
      `#cycling #procycling #${name.toLowerCase().replace(/\s+/g, "")} #results #roadcycling`,
    ].join("\n");
  }
}

// ── Publish ───────────────────────────────────────────────────────────────────
async function publish(imagePath: string, caption: string) {
  if (!ACCESS_TOKEN) {
    console.error("❌  INSTAGRAM_ACCESS_TOKEN not set in .env.local");
    process.exit(1);
  }

  console.log("Uploading image to public URL...");
  const imageUrl = await uploadImageForInstagram(imagePath);
  console.log(`  URL: ${imageUrl}`);

  console.log("Creating media container...");
  const mediaBody: Record<string, string> = { image_url: imageUrl };
  if (isStories) {
    mediaBody.media_type = "STORIES";
  } else {
    mediaBody.caption = caption;
  }
  const container = await igPost(`${ACCOUNT_ID}/media`, mediaBody);
  console.log(`  Container ID: ${container.id}`);

  // Wait for container to be ready (Instagram needs a moment to process)
  console.log("Waiting for container to be ready...");
  let status = "IN_PROGRESS";
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await igGet(`${container.id}?fields=status_code`);
    status = s.status_code;
    console.log(`  Status: ${status}`);
    if (status === "FINISHED") break;
    if (status === "ERROR") throw new Error("Container processing failed");
  }

  if (status !== "FINISHED") throw new Error(`Container not ready after wait: ${status}`);

  console.log("Publishing...");
  const post = await igPost(`${ACCOUNT_ID}/media_publish`, {
    creation_id: container.id,
  });

  await cleanupStagedImage(imageUrl);
  console.log(`✅  Published! Post ID: ${post.id}`);
  console.log(`   https://instagram.com/p/${post.id}`);
  return post.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const imagePath = get("--image");
  const eventSlug = get("--event");
  const type = get("--type") ?? "preview";
  const gender = get("--gender") ?? "men";
  const caption = get("--caption");

  let finalImagePath = imagePath;
  let finalCaption = caption ?? "";

  if (eventSlug) {
    finalImagePath = await generateCard(eventSlug, type, gender);
    if (!caption) finalCaption = await buildCaption(eventSlug, type, gender);
  }

  if (!finalImagePath || !existsSync(finalImagePath)) {
    console.error("No image found. Use --image or --event.");
    process.exit(1);
  }

  await publish(finalImagePath, finalCaption);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
