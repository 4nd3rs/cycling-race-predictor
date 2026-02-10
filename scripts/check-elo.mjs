import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// 1. Check elo_history for Junior Men La Nucía race
const juniorRaceId = "b6318437-1aba-45b3-893b-588a89416924";
const eliteRaceId = "f99450eb-5b77-4948-a726-cd0b44dc9bc1";

console.log("=== Elo History for Junior Men La Nucía ===");
const juniorRows = await sql`
  SELECT eh.*, r.name as rider_name
  FROM elo_history eh
  JOIN riders r ON r.id = eh.rider_id
  WHERE eh.race_id = ${juniorRaceId}
  ORDER BY eh.elo_change DESC
  LIMIT 10
`;
console.log(`Count: ${juniorRows.length} (showing up to 10)`);
if (juniorRows.length > 0) {
  console.table(juniorRows.map(r => ({
    rider: r.rider_name,
    discipline: r.discipline,
    category: r.age_category,
    before: r.elo_before,
    after: r.elo_after,
    change: r.elo_change,
    position: r.race_position,
  })));
} else {
  console.log("No elo_history records found for this race.");
}

// Total count for junior race
const juniorCount = await sql`
  SELECT COUNT(*) as cnt FROM elo_history WHERE race_id = ${juniorRaceId}
`;
console.log(`Total elo_history records for Junior race: ${juniorCount[0].cnt}`);

console.log("\n=== Elo History for Elite Men La Nucía ===");
const eliteRows = await sql`
  SELECT eh.*, r.name as rider_name
  FROM elo_history eh
  JOIN riders r ON r.id = eh.rider_id
  WHERE eh.race_id = ${eliteRaceId}
  ORDER BY eh.elo_change DESC
  LIMIT 10
`;
console.log(`Count: ${eliteRows.length} (showing up to 10)`);
if (eliteRows.length > 0) {
  console.table(eliteRows.map(r => ({
    rider: r.rider_name,
    discipline: r.discipline,
    category: r.age_category,
    before: r.elo_before,
    after: r.elo_after,
    change: r.elo_change,
    position: r.race_position,
  })));
} else {
  console.log("No elo_history records found for this race.");
}

const eliteCount = await sql`
  SELECT COUNT(*) as cnt FROM elo_history WHERE race_id = ${eliteRaceId}
`;
console.log(`Total elo_history records for Elite race: ${eliteCount[0].cnt}`);

// 2. Check rider_discipline_stats for MTB riders with non-default elo
console.log("\n=== Rider Discipline Stats for MTB (non-default ELO) ===");
const mtbStats = await sql`
  SELECT COUNT(*) as total,
         COUNT(*) FILTER (WHERE current_elo != '1500' AND current_elo IS NOT NULL) as non_default_elo,
         COUNT(*) FILTER (WHERE races_total > 0) as with_races
  FROM rider_discipline_stats
  WHERE discipline LIKE 'mtb%'
`;
console.table(mtbStats);

// Show top MTB riders by elo
console.log("\n=== Top 10 MTB Riders by ELO ===");
const topMtb = await sql`
  SELECT rds.discipline, rds.age_category, rds.current_elo, rds.elo_mean, rds.elo_variance,
         rds.races_total, rds.wins_total, r.name as rider_name
  FROM rider_discipline_stats rds
  JOIN riders r ON r.id = rds.rider_id
  WHERE rds.discipline LIKE 'mtb%'
  ORDER BY rds.current_elo::numeric DESC
  LIMIT 10
`;
console.table(topMtb.map(r => ({
  rider: r.rider_name,
  discipline: r.discipline,
  category: r.age_category,
  elo: r.current_elo,
  mean: r.elo_mean,
  variance: r.elo_variance,
  races: r.races_total,
  wins: r.wins_total,
})));

process.exit(0);
