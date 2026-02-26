/**
 * Fix Women's Startlist Contamination
 *
 * Removes male riders from the women's Omloop startlist.
 * A rider is male if they also appear in the men's startlist.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const MEN_RACE_ID = "bbd718a5-9a38-4e1b-aaa7-c00b99221b01";
const WOMEN_RACE_ID = "f6f9ae0b-13ef-4f29-accf-35719f187ccf";

async function main() {
  // Find riders who appear in BOTH the men's and women's startlists
  const contaminated = await sql`
    SELECT ws.id as startlist_id, r.name as rider_name, r.id as rider_id
    FROM race_startlist ws
    JOIN riders r ON r.id = ws.rider_id
    WHERE ws.race_id = ${WOMEN_RACE_ID}
      AND ws.rider_id IN (
        SELECT rider_id FROM race_startlist WHERE race_id = ${MEN_RACE_ID}
      )
  `;

  if (contaminated.length === 0) {
    console.log("No male riders found in women's startlist. Clean!");
    return;
  }

  console.log(`Found ${contaminated.length} male rider(s) in women's startlist:\n`);
  for (const row of contaminated) {
    console.log(`  - ${row.rider_name} (${row.rider_id})`);
  }

  // Delete them from the women's startlist
  const ids = contaminated.map((r: any) => r.startlist_id);
  const result = await sql`
    DELETE FROM race_startlist
    WHERE id = ANY(${ids}::uuid[])
  `;

  console.log(`\nDeleted ${contaminated.length} entries from women's startlist.`);

  // Verify
  const [after] = await sql`SELECT count(*) FROM race_startlist WHERE race_id = ${WOMEN_RACE_ID}`;
  console.log(`Women's startlist now has ${after.count} riders.`);
}

main().catch(console.error).finally(() => process.exit(0));
