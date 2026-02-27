/**
 * fix-missing-pcs-urls.ts
 * One-off: populate pcsUrl for WorldTour road races missing it.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '../../src/lib/db';
import { races } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');

// Map of race id → PCS base URL
const UPDATES: Array<{ id: string; name: string; pcsUrl: string }> = [
  // Omloop Nieuwsblad - Elite Men (duplicate entry for same race, WorldTour category)
  { id: '2b8e8c2a-5c29-4b17-8b51-8f2b63c8f79d', name: 'Omloop Nieuwsblad - Elite Men',        pcsUrl: 'https://www.procyclingstats.com/race/omloop-het-nieuwsblad/2026' },
  // Strade Bianche
  { id: '9f021263-a857-458b-87af-f982f24259f8', name: 'Strade Bianche - Elite Men',            pcsUrl: 'https://www.procyclingstats.com/race/strade-bianche/2026' },
  { id: 'fc038ece-b1b7-4bec-b168-6c0396697e2f', name: 'Strade Bianche - Elite Women',          pcsUrl: 'https://www.procyclingstats.com/race/strade-bianche-we/2026' },
  // Paris-Nice
  { id: '7b2be0ff-55e2-4703-afae-acdfd0f6e900', name: 'Paris-Nice - Elite Men',                pcsUrl: 'https://www.procyclingstats.com/race/paris-nice/2026' },
  { id: 'f2fdb0e3-2aec-41bb-a50d-2fb74645e6a1', name: 'Paris-Nice - Elite Women',              pcsUrl: 'https://www.procyclingstats.com/race/paris-nice-femmes/2026' },
  // Tirreno-Adriatico
  { id: '59a52e00-9673-4fc3-9213-2f4d0d369dd3', name: 'Tirreno-Adriatico - Elite Men',         pcsUrl: 'https://www.procyclingstats.com/race/tirreno-adriatico/2026' },
  { id: 'c259eb66-e215-41d5-afd9-ec6b2f69ea53', name: 'Tirreno-Adriatico - Elite Women',       pcsUrl: 'https://www.procyclingstats.com/race/tirreno-adriatico-donne/2026' },
  // Milano-Sanremo
  { id: '3af84eab-34e5-48cb-b5d5-421bc750d1a5', name: 'Milano-Sanremo - Elite Men',            pcsUrl: 'https://www.procyclingstats.com/race/milano-sanremo/2026' },
  { id: '435c5b91-aa91-4f81-bf5d-f96a9baf1915', name: 'Milano-Sanremo - Elite Women',          pcsUrl: 'https://www.procyclingstats.com/race/milano-sanremo-we/2026' },
  // Volta a Catalunya
  { id: '7f32ee6d-3efe-4325-adff-d8117d68ad83', name: 'Volta Ciclista a Catalunya - Elite Men',   pcsUrl: 'https://www.procyclingstats.com/race/volta-a-catalunya/2026' },
  { id: '3954f49e-5cb5-4927-aadf-93190f9559c9', name: 'Volta Ciclista a Catalunya - Elite Women', pcsUrl: 'https://www.procyclingstats.com/race/volta-a-catalunya-we/2026' },
  // E3 Saxo Classic
  { id: '3087f506-765e-4195-a214-1c428d18a610', name: 'E3 Saxo Classic ME - Elite Men',        pcsUrl: 'https://www.procyclingstats.com/race/e3-saxo-bank-classic/2026' },
  { id: 'c949008c-09a6-4468-8939-487dfad1bf78', name: 'E3 Saxo Classic ME - Elite Women',      pcsUrl: 'https://www.procyclingstats.com/race/e3-saxo-bank-classic-we/2026' },
  // Ronde Van Brugge / Tour of Bruges
  { id: 'c0a1af7f-97d4-4da1-8b2a-7a368376b478', name: 'Ronde Van Brugge - Tour of Bruges ME - Elite Men',   pcsUrl: 'https://www.procyclingstats.com/race/ronde-van-brugge/2026' },
  { id: '6067983f-d725-4525-81f5-a01de462f52a', name: 'Ronde Van Brugge - Tour of Bruges ME - Elite Women', pcsUrl: 'https://www.procyclingstats.com/race/ronde-van-brugge-we/2026' },
];

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Updating pcsUrl for ${UPDATES.length} races...\n`);

  for (const u of UPDATES) {
    if (DRY_RUN) {
      console.log(`  [dry] ${u.name} → ${u.pcsUrl}`);
    } else {
      await db.update(races)
        .set({ pcsUrl: u.pcsUrl })
        .where(eq(races.id, u.id));
      console.log(`  ✅ ${u.name} → ${u.pcsUrl}`);
    }
  }

  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
