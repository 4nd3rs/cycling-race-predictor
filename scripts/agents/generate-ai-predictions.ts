/**
 * AI Predictions Agent — Option B
 *
 * For each race in the next N days:
 * 1. Pull startlist + rider UCI points
 * 2. Pull race profile (terrain, category, country)
 * 3. Pull recent news articles about the race + key riders
 * 4. Prompt Gemini to rank top 10 riders for THIS specific race
 * 5. Store results in predictions table (source: 'ai')
 *
 * Usage:
 *   tsx generate-ai-predictions.ts [--days 7] [--race omloop-het-nieuwsblad-2026] [--dry-run]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = 'gemini-2.5-flash-lite';
const MODEL_VERSION = 'ai-v1-gemini-2.5-flash-lite';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DAYS = args.includes('--days') ? parseInt(args[args.indexOf('--days') + 1]) : 7;
const RACE_FILTER = args.includes('--race') ? args[args.indexOf('--race') + 1] : null;

// ── Terrain profiles ──────────────────────────────────────────────────────────
const TERRAIN_PROFILES: Record<string, string> = {
  'omloop': 'cobbled classic, bergs, wind — suits rouleur-puncheurs, not pure climbers or sprinters',
  'strade-bianche': 'white gravel roads, punishing — suits all-rounders with grit',
  'milan-san-remo': 'mostly flat with late Cipressa and Poggio climbs — suits sprinters with climbing ability',
  'ronde-van-vlaanderen': 'cobbles and short steep climbs — suits puncheurs and rouleurs',
  'paris-roubaix': 'long cobbled sectors — suits strong rouleurs with bike handling',
  'liege-bastogne-liege': 'hilly Ardennes, long climbs — suits pure climbers',
  'amstel-gold': 'Ardennes hills — suits puncheurs',
  'la-fleche-wallonne': 'Mur de Huy final — suits explosive puncheurs',
  'tour-de-france': 'GC race, multiple mountain stages — suits climbers and GC riders',
  'giro-ditalia': 'GC race, Italian mountains — suits climbers',
  'vuelta': 'GC race, Spanish climbs — suits climbers',
  'world-championship': 'varies by course — check specific edition',
  'default-mtb': 'cross-country mountain bike — suits XCO specialists with technical ability',
};

function getTerrainProfile(slug: string): string {
  for (const [key, profile] of Object.entries(TERRAIN_PROFILES)) {
    if (slug.toLowerCase().includes(key)) return profile;
  }
  return 'road race — check course profile for specific demands';
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function askGemini(prompt: string): Promise<string | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }),
    }
  );
  if (!res.ok) { console.error('Gemini error:', res.status, await res.text()); return null; }
  const data = await res.json();
  const finish = data.candidates?.[0]?.finishReason;
  if (finish !== 'STOP') console.warn(`  Gemini finish: ${finish}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

// ── Build prompt ──────────────────────────────────────────────────────────────
function buildPredictionPrompt(race: {
  eventName: string; slug: string; discipline: string;
  uciCategory: string; country: string; date: string;
}, startlist: Array<{ name: string; uciPoints: number | null; team: string | null }>,
news: string[]): string {

  const terrain = getTerrainProfile(race.slug);
  const startlistText = startlist
    .slice(0, 80) // cap at 80 riders to stay within token budget
    .map(r => `- ${r.name}${r.team ? ` (${r.team})` : ''}${r.uciPoints ? ` — ${r.uciPoints} UCI pts` : ''}`)
    .join('\n');
  const newsText = news.length > 0
    ? news.slice(0, 8).map(n => `- ${n}`).join('\n')
    : '- No recent news available';

  return `You are an expert cycling analyst making pre-race predictions.

RACE: ${race.eventName}
DATE: ${race.date}
COUNTRY: ${race.country}
CATEGORY: ${race.uciCategory}
DISCIPLINE: ${race.discipline === 'mtb' ? 'Mountain Bike XCO' : 'Road'}
TERRAIN PROFILE: ${terrain}

STARTLIST (with ELO rating for reference — higher = stronger historical results):
${startlistText}

RECENT NEWS AND RUMOURS:
${newsText}

TASK:
Rank the top 10 riders for this specific race.

If recent news IS available: weight it heavily — injuries, withdrawals, form, and team dynamics all matter.
If NO news is available: rank by ELO rating adjusted for terrain suitability. State "Based on ELO rating" in the reasoning for those riders.

Your ranking must account for:
1. How well each rider's STYLE suits this terrain (cobbled classics = rouleur-puncheur, climbs = pure climber, XCO = technical fitness)
2. Current form and fitness from news (if available)
3. Any reported injuries, illness, or withdrawals (if available)
4. ELO rating as strength indicator — use directly when news is absent
5. For junior/u23 with no news: rank strictly by ELO

For each ranked rider, provide:
- A brief reason (1 sentence max) explaining why they rank here

RESPOND IN THIS EXACT JSON FORMAT — nothing else, no markdown, no preamble:
{
  "predictions": [
    {"position": 1, "name": "Exact Rider Name As In Startlist", "reasoning": "One sentence why"},
    {"position": 2, "name": "...", "reasoning": "..."},
    ...up to 10
  ],
  "race_summary": "2-3 sentence overview of the race dynamics and key factors"
}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nAI Predictions Agent${DRY_RUN ? ' [DRY RUN]' : ''} — next ${DAYS} days\n`);

  const today = new Date().toISOString().split('T')[0];
  const until = new Date(Date.now() + DAYS * 86400000).toISOString().split('T')[0];

  let racesQuery;
  if (RACE_FILTER) {
    racesQuery = await sql`
      SELECT r.id as race_id, r.name as race_name, r.discipline, r.uci_category, r.category_slug,
             re.name as event_name, re.country, re.slug, re.discipline as event_discipline, re.date
      FROM races r JOIN race_events re ON re.id = r.race_event_id
      WHERE re.slug = ${RACE_FILTER} AND r.status = 'active'
    `;
  } else {
    racesQuery = await sql`
      SELECT r.id as race_id, r.name as race_name, r.discipline, r.uci_category, r.category_slug,
             re.name as event_name, re.country, re.slug, re.discipline as event_discipline, re.date
      FROM races r JOIN race_events re ON re.id = r.race_event_id
      WHERE r.date::date BETWEEN ${today}::date AND ${until}::date
        AND r.status = 'active'
      ORDER BY r.date
    `;
  }

  console.log(`Found ${racesQuery.length} race(s)\n`);

  for (const race of racesQuery) {
    console.log(`\n${race.event_name} — ${race.race_name}`);

    // Get startlist with UCI points
    const startlist = await sql`
      SELECT ri.name, COALESCE(rds.current_elo, 0) as rating, rds.wins_total, rds.podiums_total, t.name as team_name
      FROM race_startlist rs
      JOIN riders ri ON ri.id = rs.rider_id
      LEFT JOIN teams t ON t.id = ri.team_id
      LEFT JOIN rider_discipline_stats rds ON rds.rider_id = ri.id
      WHERE rs.race_id = ${race.race_id}
      ORDER BY COALESCE(rds.current_elo, 0) DESC NULLS LAST
    `;

    if (startlist.length === 0) {
      console.log('  No startlist — skipping');
      continue;
    }
    console.log(`  Startlist: ${startlist.length} riders`);

    // Get recent news for this race event
    const news = await sql`
      SELECT title FROM race_news
      WHERE race_event_id = (SELECT race_event_id FROM races WHERE id = ${race.race_id})
      ORDER BY published_at DESC LIMIT 8
    `;

    const raceInfo = {
      eventName: race.event_name as string,
      slug: race.slug as string,
      discipline: (race.event_discipline || race.discipline) as string,
      uciCategory: (race.uci_category || '') as string,
      country: (race.country || '') as string,
      date: typeof race.date === 'string' ? race.date.split('T')[0] : new Date(race.date as Date).toISOString().split('T')[0],
    };

    const prompt = buildPredictionPrompt(
      raceInfo,
      startlist.map((r: any) => ({ name: r.name, uciPoints: r.rating ? Math.round(r.rating) : null, team: r.team_name })),
      news.map((n: any) => n.title)
    );

    if (DRY_RUN) {
      console.log('  [DRY RUN] Would generate predictions');
      console.log('  Prompt length:', prompt.length, 'chars');
      continue;
    }

    console.log('  Generating AI predictions...');
    const raw = await askGemini(prompt);
    if (!raw) { console.error('  Failed to get response'); continue; }

    // Parse JSON response
    let parsed: { predictions: Array<{ position: number; name: string; reasoning: string }>; race_summary: string };
    try {
      const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('  Failed to parse JSON:', raw.slice(0, 200));
      continue;
    }

    console.log(`  Got ${parsed.predictions.length} predictions`);
    console.log(`  Summary: ${parsed.race_summary?.slice(0, 100)}...`);

    // Match names to rider IDs in DB (fuzzy match on name)
    const riderNames = parsed.predictions.map(p => p.name);
    const matchedRiders = await sql`
      SELECT ri.id, ri.name
      FROM riders ri
      JOIN race_startlist rs ON rs.rider_id = ri.id
      WHERE rs.race_id = ${race.race_id}
        AND ri.name = ANY(${riderNames})
    `;

    const riderMap = new Map(matchedRiders.map((r: any) => [r.name.toLowerCase(), r.id]));
    console.log(`  Matched ${matchedRiders.length}/${riderNames.length} riders to DB`);

    // Delete existing AI predictions for this race
    await sql`DELETE FROM predictions WHERE race_id = ${race.race_id} AND source = 'ai'`;

    // Calculate win probabilities (simple decay: 1st=20%, 2nd=15%, etc.)
    const WP = [0.20, 0.15, 0.12, 0.09, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02];

    let inserted = 0;
    for (const pred of parsed.predictions) {
      const riderId = riderMap.get(pred.name.toLowerCase());
      if (!riderId) {
        console.log(`  No DB match for: ${pred.name}`);
        continue;
      }
      const wp = WP[pred.position - 1] ?? 0.01;
      await sql`
        INSERT INTO predictions (race_id, rider_id, predicted_position, win_probability,
          podium_probability, top10_probability, reasoning, source, model_version, version)
        VALUES (
          ${race.race_id}, ${riderId}, ${pred.position}, ${wp},
          ${pred.position <= 3 ? 0.35 : 0.05},
          ${pred.position <= 10 ? 0.6 : 0.15},
          ${pred.reasoning}, 'ai', ${MODEL_VERSION}, 2
        )
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    }
    console.log(`  Inserted/updated ${inserted} predictions`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
