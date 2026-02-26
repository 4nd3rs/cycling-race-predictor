/**
 * Convert "CLAES Lotte" → "Lotte Claes" for women's Omloop startlist riders
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const RACE_ID = "f6f9ae0b-13ef-4f29-accf-35719f187ccf";

function normalizePcsName(raw: string): string {
  // "CLAES Lotte" → "Lotte Claes"
  // "VAN DEN BERG Eva" → "Eva Van Den Berg"
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return raw;
  // Last token is first name (already title case), rest is CAPS surname
  const firstName = parts[parts.length - 1];
  const lastName = parts.slice(0, -1)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return `${firstName} ${lastName}`;
}

async function main() {
  // Get all riders in the Women's Omloop startlist via join
  const entries = await db
    .select({ riderId: schema.raceStartlist.riderId, name: schema.riders.name })
    .from(schema.raceStartlist)
    .innerJoin(schema.riders, eq(schema.raceStartlist.riderId, schema.riders.id))
    .where(eq(schema.raceStartlist.raceId, RACE_ID));

  console.log(`Found ${entries.length} startlist entries`);

  let updated = 0;
  for (const entry of entries) {
    const name = entry.name;

    // Skip if already normalized (doesn't look like "CAPS firstname")
    // A raw PCS name will have at least one ALL-CAPS word followed by a title-case word
    const hasCapsWord = /^[A-ZÉÀÂÜÙÛÎÏÔŒÆÇ\s]+[A-Z]{2,}/.test(name);
    if (!hasCapsWord) {
      continue; // Already normalized
    }

    const normalized = normalizePcsName(name);
    if (normalized === name) continue;

    await db.update(schema.riders)
      .set({ name: normalized })
      .where(eq(schema.riders.id, entry.riderId));

    console.log(`  ${name} → ${normalized}`);
    updated++;
  }

  console.log(`\n✅ Normalized ${updated} rider names`);
}

main().catch(console.error).finally(() => process.exit(0));
