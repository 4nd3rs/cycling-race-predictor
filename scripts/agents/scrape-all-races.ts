import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { gte, isNotNull, and } from "drizzle-orm";
import { raceEvents } from "../../src/lib/db/schema";
import { execSync } from "child_process";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function main() {
  const today = new Date().toISOString().split("T")[0];

  const events = await db
    .select({ id: raceEvents.id, name: raceEvents.name, slug: raceEvents.slug, date: raceEvents.date })
    .from(raceEvents)
    .where(and(gte(raceEvents.date, today), isNotNull(raceEvents.slug)));

  console.log(`\nFound ${events.length} upcoming events:\n`);
  events.forEach(e => console.log(`  - ${e.date}: ${e.name} (${e.slug})`));

  const results: Array<{ name: string; inserted: number }> = [];

  for (const event of events) {
    if (!event.slug) continue;
    console.log(`\n${"=".repeat(60)}`);
    try {
      const output = execSync(
        `node_modules/.bin/tsx scripts/agents/scrape-race-news.ts ${event.slug}`,
        { cwd: process.cwd(), encoding: "utf8", timeout: 60000 }
      );
      const match = output.match(/Total inserted: (\d+)/);
      const inserted = match ? parseInt(match[1]) : 0;
      results.push({ name: event.name, inserted });
      console.log(output);
    } catch (e: any) {
      console.error(`Error scraping ${event.slug}:`, e.message);
      results.push({ name: event.name, inserted: -1 });
    }
  }

  console.log("\n\n📊 SUMMARY");
  console.log("=".repeat(60));
  let grandTotal = 0;
  for (const { name, inserted } of results) {
    console.log(`  ${inserted >= 0 ? String(inserted).padStart(3) : "ERR"} articles  →  ${name}`);
    if (inserted > 0) grandTotal += inserted;
  }
  console.log(`\n  Grand total new articles: ${grandTotal}`);
}

main().catch(console.error);
