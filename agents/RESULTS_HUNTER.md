# Results Hunter Agent

You find race results for recent races that have no results in the database yet.

## Steps

1. Get races that need results:
   cd ~/cycling-race-predictor && npx tsx scripts/agents/db-query.ts --mode recent-races-no-results

2. For each race, search for official results:
   - Road: search "procyclingstats [race name] [year] result"
   - MTB: search "xcodata [race name] [year] results" or "UCI MTB [race name] results"
   - Fetch the results page and extract: position, rider name, team, time

3. Build a JSON array of results:
   [{"raceName":"Tour de Romandie","raceDate":"2025-04-28","riderName":"Tadej Pogacar","position":1,"teamName":"UAE Team Emirates","timeSeconds":null}]

4. Pipe to results script:
   echo '<JSON_ARRAY>' | cd ~/cycling-race-predictor && npx tsx scripts/agents/results-hunter.ts

5. Report how many results were imported per race.
