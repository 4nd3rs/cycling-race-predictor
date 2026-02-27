/**
 * add-mtb-categories.ts
 * Adds Junior Men, Junior Women, U23 Men, U23 Women race rows for all MTB events
 * that currently only have Elite Men/Women.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

const EXTRA_CATEGORIES = [
  { slug: "u23-men",     suffix: "U23 Men" },
  { slug: "u23-women",   suffix: "U23 Women" },
  { slug: "junior-men",  suffix: "Junior Men" },
  { slug: "junior-women",suffix: "Junior Women" },
];

async function main() {
  // Get all MTB events
  const events = await sqlClient`
    SELECT DISTINCT re.id as event_id, re.name as event_name
    FROM race_events re
    JOIN races r ON r.race_event_id = re.id
    WHERE re.discipline = 'mtb'
  `;
  console.log(`Found ${events.length} MTB events`);
  
  let inserted = 0, skipped = 0;
  for (const event of events) {
    // Get the Elite Men race as template (for date, status, etc.)
    const template = await sqlClient`
      SELECT * FROM races WHERE race_event_id = ${event.event_id} AND category_slug = 'elite-men' LIMIT 1
    `;
    if (!template.length) {
      console.log(`  ⚠️  No elite-men race for ${event.event_name}, skipping`);
      continue;
    }
    const tmpl = template[0];
    
    for (const cat of EXTRA_CATEGORIES) {
      // Check if already exists
      const exists = await sqlClient`
        SELECT id FROM races WHERE race_event_id = ${event.event_id} AND category_slug = ${cat.slug}
      `;
      if (exists.length) { skipped++; continue; }
      
      const raceName = `${event.event_name} - ${cat.suffix}`;
      await db.insert(schema.races).values({
        name: raceName,
        raceEventId: event.event_id,
        date: tmpl.date,
        endDate: tmpl.end_date,
        status: tmpl.status,
        categorySlug: cat.slug,
        discipline: "mtb",
      });
      inserted++;
    }
  }
  console.log(`Done: ${inserted} categories added, ${skipped} already existed`);
}
main().catch(console.error);
