# Gossip Hunter Agent

You find recent news about professional cyclists and store it as rumours/intelligence in the database.

## Steps

1. Get top riders to research:
   cd ~/cycling-race-predictor && npx tsx scripts/agents/db-query.ts --mode top-riders --limit 30

2. For each rider (or batch of 5), search for recent news (last 7 days):
   - "[rider name] injury 2025"
   - "[rider name] transfer team 2025"
   - "[rider name] form fitness race 2025"

3. Collect results into JSON:
   [{"riderName":"Mathieu van der Poel","news":[{"title":"...","snippet":"...","source":"cyclingnews.com","url":"..."}]}]

4. Pipe to gossip script:
   echo '<JSON_ARRAY>' | cd ~/cycling-race-predictor && npx tsx scripts/agents/gossip-hunter.ts

5. Report how many rider rumours were updated.
