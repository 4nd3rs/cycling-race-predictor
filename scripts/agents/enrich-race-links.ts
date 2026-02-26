/**
 * enrich-race-links.ts
 *
 * Populates `external_links` on race_events for upcoming high-hype races.
 * Uses a curated seed for known WorldTour/WC events, then falls back to
 * web-search + Claude for unknowns.
 *
 * Run: node_modules/.bin/tsx scripts/agents/enrich-race-links.ts [--all] [--dry-run]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { db, raceEvents, races } from '../../src/lib/db';
import { gte, eq, and, isNull, sql } from 'drizzle-orm';
const DRY_RUN = process.argv.includes('--dry-run');
const DO_ALL  = process.argv.includes('--all'); // include already-enriched

// ---------------------------------------------------------------------------
// Curated seed data for well-known races
// Match on event name substring (case-insensitive)
// ---------------------------------------------------------------------------
interface RaceLinks {
  website?: string;
  twitter?: string;
  instagram?: string;
  facebook?: string;
  youtube?: string;
  liveStream?: Array<{ name: string; url: string; regions?: string; free?: boolean }>;
  tracking?: string;
}

const CURATED: Array<{ match: string | RegExp; links: RaceLinks }> = [
  // ──────────────── ROAD ────────────────
  {
    match: /omloop het nieuwsblad/i,
    links: {
      website:   'https://www.omloophetnieuwsblad.be',
      twitter:   'https://twitter.com/OmloopHNB',
      instagram: 'https://www.instagram.com/omloophetnieuwsblad/',
      liveStream: [
        { name: 'Eurosport 1', url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'Discovery+',  url: 'https://www.discoveryplus.com', regions: 'Nordics/EU', free: false },
        { name: 'HBO Max',     url: 'https://www.hbomax.com', regions: 'Select markets', free: false },
        { name: 'GCN+',        url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
      ],
      tvSchedule: [
        { region: '🇧🇪 Belgium',      channel: 'Sporza (VRT)',  startTime: '13:30 CET', url: 'https://sporza.be' },
        { region: '🌍 Europe',        channel: 'Eurosport 1',   startTime: '13:30 CET', url: 'https://eurosport.com' },
        { region: '🌐 International', channel: 'Discovery+',    startTime: '13:30 CET', url: 'https://discoveryplus.com' },
        { region: '🇬🇧 UK',           channel: 'TNT Sports',    url: 'https://www.tntsports.co.uk' },
        { region: '🇺🇸🇨🇦 USA/Canada', channel: 'FloBikes',      url: 'https://www.flobikes.com' },
        { region: '🇫🇷 France',       channel: "L'Équipe TV",   url: 'https://lequipe.fr' },
        { region: '🇳🇱 Netherlands',  channel: 'NOS',           url: 'https://nos.nl' },
        { region: '🇩🇰 Denmark',      channel: 'TV2 Sport',     url: 'https://tv2.dk' },
        { region: '🇦🇹 Austria',      channel: 'ORF',           url: 'https://orf.at' },
      ],
      raceStart:  '11:15 CET',
      raceFinish: '~15:50 CET',
    },
  },
  {
    match: /omloop nieuwsblad/i,
    links: {
      website:   'https://www.omloophetnieuwsblad.be',
      twitter:   'https://twitter.com/OmloopHNB',
      instagram: 'https://www.instagram.com/omloophetnieuwsblad/',
      liveStream: [
        { name: 'Eurosport 1', url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'Discovery+',  url: 'https://www.discoveryplus.com', regions: 'Nordics/EU', free: false },
        { name: 'HBO Max',     url: 'https://www.hbomax.com', regions: 'Select markets', free: false },
        { name: 'GCN+',        url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
      ],
      tvSchedule: [
        { region: '🇧🇪 Belgium',      channel: 'Sporza (VRT)',  startTime: '13:30 CET', url: 'https://sporza.be' },
        { region: '🌍 Europe',        channel: 'Eurosport 1',   startTime: '13:30 CET', url: 'https://eurosport.com' },
        { region: '🌐 International', channel: 'Discovery+',    startTime: '13:30 CET', url: 'https://discoveryplus.com' },
        { region: '🇬🇧 UK',           channel: 'TNT Sports',    url: 'https://www.tntsports.co.uk' },
        { region: '🇺🇸🇨🇦 USA/Canada', channel: 'FloBikes',      url: 'https://www.flobikes.com' },
        { region: '🇫🇷 France',       channel: "L'Équipe TV",   url: 'https://lequipe.fr' },
        { region: '🇳🇱 Netherlands',  channel: 'NOS',           url: 'https://nos.nl' },
        { region: '🇩🇰 Denmark',      channel: 'TV2 Sport',     url: 'https://tv2.dk' },
        { region: '🇦🇹 Austria',      channel: 'ORF',           url: 'https://orf.at' },
      ],
      raceStart:  '11:15 CET',
      raceFinish: '~15:50 CET',
    },
  },
  {
    match: /strade bianche/i,
    links: {
      website:   'https://www.strade-bianche.it',
      twitter:   'https://twitter.com/StradeB_ITA',
      instagram: 'https://www.instagram.com/stradebianche/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RAI Sport',  url: 'https://www.raiplay.it', regions: 'Italy', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /paris.nice/i,
    links: {
      website:   'https://www.paris-nice.fr',
      twitter:   'https://twitter.com/ParisNice',
      instagram: 'https://www.instagram.com/paris_nice_official/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'France TV',  url: 'https://www.france.tv/sport', regions: 'France', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /tirreno.adriatico/i,
    links: {
      website:   'https://www.tirrenoadriatico.it',
      twitter:   'https://twitter.com/TirrenoAdriatico',
      instagram: 'https://www.instagram.com/tirrenoadriatico/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RAI Sport',  url: 'https://www.raiplay.it', regions: 'Italy', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /milan.san remo|milano.sanremo/i,
    links: {
      website:   'https://www.milanosanremo.it',
      twitter:   'https://twitter.com/MilanoSanremo',
      instagram: 'https://www.instagram.com/milanosanremo_official/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RAI Sport',  url: 'https://www.raiplay.it', regions: 'Italy', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /e3 saxo/i,
    links: {
      website:   'https://www.e3saxobankclassic.be',
      twitter:   'https://twitter.com/E3SaxoBank',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'Discovery+', url: 'https://www.discoveryplus.com', regions: 'Nordics', free: false },
      ],
    },
  },
  {
    match: /gent.wevelgem/i,
    links: {
      website:   'https://www.gent-wevelgem.be',
      twitter:   'https://twitter.com/GentWevelgem',
      instagram: 'https://www.instagram.com/gentwevelgem/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'Discovery+', url: 'https://www.discoveryplus.com', regions: 'Nordics', free: false },
      ],
    },
  },
  {
    match: /ronde van vlaanderen|tour of flanders/i,
    links: {
      website:   'https://www.rondevlaanderen.be',
      twitter:   'https://twitter.com/RondeVlaanderen',
      instagram: 'https://www.instagram.com/rondevlaanderen/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'Discovery+', url: 'https://www.discoveryplus.com', regions: 'Nordics', free: false },
      ],
      tracking: 'https://live.rondevlaanderen.be',
    },
  },
  {
    match: /paris.roubaix/i,
    links: {
      website:   'https://www.paris-roubaix.fr',
      twitter:   'https://twitter.com/ParisRoubaix',
      instagram: 'https://www.instagram.com/paris_roubaix_official/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'France TV',  url: 'https://www.france.tv/sport', regions: 'France', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /amstel gold/i,
    links: {
      website:   'https://www.amstelgoldrace.nl',
      twitter:   'https://twitter.com/AmstelGoldRace',
      instagram: 'https://www.instagram.com/amstelgoldrace/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'Discovery+', url: 'https://www.discoveryplus.com', regions: 'Nordics', free: false },
      ],
    },
  },
  {
    match: /la fl.che wallonne/i,
    links: {
      website:   'https://www.flechewallonne.be',
      twitter:   'https://twitter.com/flechewallonne',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
      ],
    },
  },
  {
    match: /li.ge.bastogne/i,
    links: {
      website:   'https://www.liege-bastogne-liege.be',
      twitter:   'https://twitter.com/LiegeBastogneLG',
      instagram: 'https://www.instagram.com/liegebastogneliege/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
      ],
    },
  },
  {
    match: /tour de france/i,
    links: {
      website:   'https://www.letour.fr',
      twitter:   'https://twitter.com/LeTour',
      instagram: 'https://www.instagram.com/letourdefrance/',
      youtube:   'https://www.youtube.com/c/letourdefrance',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'France TV',  url: 'https://www.france.tv/sport', regions: 'France', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
      tracking: 'https://www.letour.fr/en/race/TDF/2026/stage-1/live',
    },
  },
  {
    match: /giro d.italia/i,
    links: {
      website:   'https://www.giroditalia.it',
      twitter:   'https://twitter.com/giroditalia',
      instagram: 'https://www.instagram.com/giroditalia/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RAI Sport',  url: 'https://www.raiplay.it', regions: 'Italy', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /vuelta a espa.a/i,
    links: {
      website:   'https://www.lavuelta.es',
      twitter:   'https://twitter.com/lavuelta',
      instagram: 'https://www.instagram.com/lavuelta/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RTVE',       url: 'https://www.rtve.es/deporte', regions: 'Spain', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  // ──────────────── MORE ROAD ────────────────
  {
    match: /itzulia|basque country/i,
    links: {
      website:   'https://www.itzulia.eus',
      twitter:   'https://twitter.com/itzulia_bask',
      instagram: 'https://www.instagram.com/itzulia_basquecountry/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'EITB',       url: 'https://www.eitb.eus', regions: 'Basque Country', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /volta.+catalunya/i,
    links: {
      website:   'https://www.voltacatalunya.cat',
      twitter:   'https://twitter.com/VoltaCatalunya',
      instagram: 'https://www.instagram.com/voltacatalunya/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'TV3',        url: 'https://www.ccma.cat/tv3/esport3/', regions: 'Catalonia', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /tour de romandie/i,
    links: {
      website:   'https://www.tourderomandie.ch',
      twitter:   'https://twitter.com/TourDeRomandie',
      instagram: 'https://www.instagram.com/tourderomandie/',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'RTS Sport',  url: 'https://www.rts.ch/sport', regions: 'Switzerland', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /eschborn.frankfurt/i,
    links: {
      website:   'https://www.eschborn-frankfurt.de',
      twitter:   'https://twitter.com/EschbornFfm',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'ARD',        url: 'https://www.daserste.de/sport', regions: 'Germany', free: true },
        { name: 'FloBikes',   url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /dwars door vlaanderen|travers.la.flandre/i,
    links: {
      website:   'https://www.dwarsdoorvlaanderen.be',
      twitter:   'https://twitter.com/DwarsDVlaand',
      liveStream: [
        { name: 'Eurosport',  url: 'https://www.eurosport.com', regions: 'EU' },
        { name: 'GCN+',       url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'Sporza',     url: 'https://www.sporza.be', regions: 'Belgium', free: true },
        { name: 'Discovery+', url: 'https://www.discoveryplus.com', regions: 'Nordics', free: false },
      ],
    },
  },
  // ──────────────── MTB ────────────────
  {
    match: /uci.+mountain bike.+world cup|uci mtb world cup|mountain bike world cup/i,
    links: {
      website:   'https://www.uci.org/mountain-bike',
      twitter:   'https://twitter.com/UCI_MTB',
      instagram: 'https://www.instagram.com/uci_mtb/',
      youtube:   'https://www.youtube.com/c/ucichannel',
      liveStream: [
        { name: 'Red Bull TV', url: 'https://www.redbull.com/tv', regions: 'worldwide', free: true },
        { name: 'GCN+',        url: 'https://plus.globalcyclingnetwork.com', regions: 'worldwide', free: false },
        { name: 'FloBikes',    url: 'https://www.flobikes.com', regions: 'US/CA', free: false },
      ],
    },
  },
  {
    match: /gran premio zaragoza/i,
    links: {
      website:   'https://www.copacatalana.com',
      twitter:   'https://twitter.com/CopaCatalanaMTB',
      liveStream: [
        { name: 'UCI MTB YouTube', url: 'https://www.youtube.com/c/ucichannel', regions: 'worldwide', free: true },
      ],
    },
  },
  {
    match: /vtt chabrières/i,
    links: {
      website:   'https://www.vtt-chabrieres.fr',
      liveStream: [
        { name: 'UCI MTB YouTube', url: 'https://www.youtube.com/c/ucichannel', regions: 'worldwide', free: true },
      ],
    },
  },
];

// AI fallback removed — curated data covers all major races (WorldTour / WC / 1.Pro)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Get upcoming high-hype events
  const events = await db
    .select({ id: raceEvents.id, name: raceEvents.name, discipline: raceEvents.discipline, country: raceEvents.country, externalLinks: raceEvents.externalLinks })
    .from(raceEvents)
    .innerJoin(races, eq(races.raceEventId, raceEvents.id))
    .where(gte(raceEvents.date, today))
    .groupBy(raceEvents.id, raceEvents.name, raceEvents.discipline, raceEvents.country, raceEvents.externalLinks)
    .orderBy(raceEvents.date);

  // De-dupe by event id
  const seen = new Set<string>();
  const unique = events.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

  const toProcess = DO_ALL
    ? unique
    : unique.filter(e => !e.externalLinks || Object.keys(e.externalLinks).length === 0);

  console.log(`\n📋 ${toProcess.length} events to enrich (${unique.length} total upcoming)\n`);

  for (const ev of toProcess) {
    console.log(`🏁 ${ev.name} (${ev.discipline})`);

    // Try curated first
    const curated = CURATED.find(c =>
      typeof c.match === 'string' ? ev.name.toLowerCase().includes(c.match.toLowerCase()) : c.match.test(ev.name)
    );

    if (!curated) {
      console.log(`  ⏭  No curated entry — skipping`);
      continue;
    }

    console.log(`  ✅ Curated match`);
    const links: RaceLinks = curated.links;

    if (Object.keys(links).length === 0) {
      console.log(`  ⏭  No links found, skipping`);
      continue;
    }

    console.log(`  📝 Links: ${Object.keys(links).join(', ')}`);

    if (!DRY_RUN) {
      await db.update(raceEvents).set({ externalLinks: links }).where(eq(raceEvents.id, ev.id));
    }
  }

  console.log('\n✅ Done!');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
