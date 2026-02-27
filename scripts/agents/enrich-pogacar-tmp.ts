import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { chromium } from "playwright";
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.procyclingstats.com/rider/tadej-pogacar", { waitUntil: "networkidle", timeout: 15000 });
  const html = await page.content();
  const igMatch = html.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
  const ig = igMatch?.[1] ?? null;
  await browser.close();

  const wikiRes = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/Tadej_Poga%C4%8Dar");
  const wiki = await wikiRes.json() as any;

  await db.update(schema.riders).set({
    instagramHandle: ig,
    bio: wiki.extract ?? null,
    photoUrl: wiki.thumbnail?.source ?? null,
    nationality: "SLO",
  }).where(eq(schema.riders.id, "c568706d-e6b7-4a1c-b938-fbd5b64eb345"));

  console.log("Updated Pogačar: ig=" + ig + " | photo=" + (wiki.thumbnail?.source ? "yes" : "no") + " | bio=" + (wiki.extract ? wiki.extract.substring(0,80) + "..." : "no"));
}
main().catch(console.error);
