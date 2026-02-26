# Race Calendar Agent

Syncs upcoming UCI road and MTB races into the database.

## Steps

1. Run the calendar sync:
   cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/sync-race-calendar.ts --discipline all --months 3

2. For each new race added, run predictions:
   cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/generate-predictions.ts --race-id <id>

3. Report how many races were added/updated.

## Sources
- Road: ProCyclingStats (https://www.procyclingstats.com/races.php)
- MTB: XCOdata (https://www.xcodata.com)
- Supplemental: UCI official calendar

## Schedule
- Runs daily at 06:00 (before Race Scout) to keep calendar fresh
- Also runs every Monday to catch newly announced races
