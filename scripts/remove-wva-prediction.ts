/**
 * Remove Van Aert from Men's Omloop Predictions
 *
 * Wout van Aert is withdrawn — delete his prediction.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const MEN_RACE_ID = "bbd718a5-9a38-4e1b-aaa7-c00b99221b01";

async function main() {
  // Find Van Aert's rider ID
  const riders = await sql`
    SELECT id, name FROM riders WHERE name ILIKE '%van aert%'
  `;

  if (riders.length === 0) {
    console.log("No rider matching 'van aert' found.");
    return;
  }

  console.log(`Found rider(s): ${riders.map((r: any) => `${r.name} (${r.id})`).join(", ")}`);

  for (const rider of riders) {
    // Delete prediction
    const result = await sql`
      DELETE FROM predictions
      WHERE race_id = ${MEN_RACE_ID}
        AND rider_id = ${rider.id}
      RETURNING id
    `;
    console.log(`Deleted ${result.length} prediction(s) for ${rider.name}`);

    // Also mark as DNS in startlist
    const updated = await sql`
      UPDATE race_startlist
      SET status = 'dns'
      WHERE race_id = ${MEN_RACE_ID}
        AND rider_id = ${rider.id}
      RETURNING id
    `;
    console.log(`Marked ${updated.length} startlist entry as DNS for ${rider.name}`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
