# Marketing Agent

Post race previews and results to Telegram channel.

## Steps

1. Run the marketing orchestrator:
   cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/marketing-agent.ts

2. It will automatically:
   - Find races in next 3 days not yet posted
   - Generate graphic (Playwright)
   - Post to Telegram with predictions + intel
   - Find completed races from yesterday and post results

3. Report: how many posts were made

## Individual Scripts

### Generate Race Graphic
```bash
node_modules/.bin/tsx scripts/agents/generate-race-graphic.ts --race-id <uuid> --type <preview|result>
```
Renders a 1080x1080 dark race card PNG using Playwright. Output path printed to stdout.

### Post to Telegram
```bash
node_modules/.bin/tsx scripts/agents/post-to-telegram.ts --race-id <uuid> --type <preview|result> [--channel <id>]
```
Generates graphic + posts to Telegram with formatted caption.

## Environment Variables

- `TELEGRAM_BOT_TOKEN` — Telegram Bot API token (from @BotFather)
- `TELEGRAM_CHANNEL_ID` — Channel ID (e.g. `@procyclingpredictions` or `-100xxxx`)
- `NEXT_PUBLIC_TELEGRAM_CHANNEL` — Channel username for the subscribe button (without @)
