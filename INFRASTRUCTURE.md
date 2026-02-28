# Infrastructure & Agent Architecture

_Last updated: 2026-02-28_

## Overview

Pro Cycling Predictor runs a hybrid architecture: user-facing agents live on **Vercel** (always on, Mac-independent), while heavier background tasks run on a **Mac mini** home server.

---

## Vercel Cron Jobs (Cloud — always on)

All routes live in `src/app/api/cron/`. Secured via `Authorization: Bearer $CRON_SECRET` header.

| Route | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/send-notifications` | every 2h :00 | Personal Telegram DMs + WhatsApp alerts to followers |
| `/api/cron/marketing-agent` | every 2h :00 | Posts race previews + results to Telegram channel + Instagram |
| `/api/cron/results-hunter` | every 2h :00 | Checks PCS + Cyclingnews for race results, writes to DB |
| `/api/cron/scrape-race-news` | every 2h :15 | Cyclingnews + VeloNews RSS → race_news table |
| `/api/cron/gossip-hunter` | every 2h :30 | Scrapes transfers/injuries/rumours → riderRumours table |
| `/api/cron/sync-startlists` | every 2h :30 | Scrapes PCS startlists via scrape.do → raceStartlist table |
| `/api/cron/sync-race-calendar` | daily 05:00 | Syncs UCI road + MTB calendar from PCS + XCOdata |
| `/api/cron/scrape-results` | daily 06:00 | _(existing)_ Full results scrape |
| `/api/cron/process-tips` | every 1h | _(existing)_ Process user tips |
| `/api/cron/update-elo` | every 15min | _(existing)_ ELO recalculation |
| `/api/cron/sync-mtb-rankings` | Tuesdays 10:00 | _(existing)_ MTB UCI rankings sync |

### Triggering manually

```bash
curl -X GET "https://procyclingpredictor.com/api/cron/<route-name>" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Test mode (notifications only)

Sends a real WhatsApp + Telegram message to all connected users — useful for testing delivery:

```bash
curl -X GET "https://procyclingpredictor.com/api/cron/send-notifications?test=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Agent Policy Files

Each agent has a policy/memory markdown file in `agents/` that defines its behaviour, sources, deduplication rules, and decision logic:

| File | Agent |
|---|---|
| `agents/marketing-agent.md` | Brand voice, posting rules, quiet hours |
| `agents/gossip-hunter.md` | Sources, confidence scoring, dedup |
| `agents/results-hunter.md` | Matching rules, data quality gates |
| `agents/scrape-race-news.md` | RSS sources, freshness policy |
| `agents/send-notifications.md` | Frequency gates, quiet hours, message types |
| `agents/sync-startlists.md` | PCS scraping rules, rate limits |
| `agents/sync-race-calendar.md` | Calendar sync policy |

---

## Web Scraping

PCS (ProCyclingStats) is scraped via **[scrape.do](https://scrape.do)** — handles Cloudflare, JS rendering, proxies.

- Utility: `src/lib/scraper/scrape-do.ts`
- Token: `SCRAPE_DO_TOKEN` env var
- Usage: `const html = await scrapeDo(url)` — returns full rendered HTML, parse with cheerio

No Playwright anywhere in the codebase.

---

## Mac Mini Cron Jobs (OpenClaw)

Background tasks that are lower priority or require more compute. If the Mac is down, these pause — but user-facing features are unaffected.

| Job | Schedule | What it does |
|---|---|---|
| 🔮 Predictions Agent | 07:00 + 15:00 daily | Generates TrueSkill predictions for upcoming races |
| 🔮 AI Predictions | 07:00 daily | LLM-enhanced prediction narratives |
| 👤 Rider Enrichment | every 8h | Wikipedia bios + photos for riders |
| 🔍 Race Scout | every 12h | Finds newly announced races |
| 📊 Road UCI Sync | Tuesdays 14:00 | PCS UCI road rankings |
| 🏔️ MTB UCI Rankings | Tuesdays 10:00 | MTB UCI rankings |
| 🔑 Instagram Token Refresh | every 50 days | Refreshes Meta long-lived token |
| 3am Backup | 03:00 daily | System backup |
| 4am OpenClaw Update | 04:00 daily | OpenClaw gateway self-update |
| PCP Daily QA Report | 05:00 daily | Data quality checks |

---

## Notification Channels

| Channel | What | How |
|---|---|---|
| Telegram DM | Personal race alerts to followers | Bot API via `TELEGRAM_BOT_TOKEN` |
| WhatsApp DM | Personal race alerts to followers | Twilio via `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` |
| Telegram channel | Broadcast previews + results | `@procyclingpredictions` |
| Instagram | Race graphics | `@procyclingpredictor` via Meta Graph API |
| WhatsApp channels | Broadcast (road men/women, MTB) | Free broadcast channels |

---

## Key Environment Variables

| Variable | Used by |
|---|---|
| `DATABASE_URL` | All DB access (Neon Postgres) |
| `CRON_SECRET` | Vercel cron auth |
| `SCRAPE_DO_TOKEN` | PCS scraping |
| `TELEGRAM_BOT_TOKEN` | Telegram notifications |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | WhatsApp |
| `TWILIO_WHATSAPP_NUMBER` | WhatsApp sender |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram posting |
| `GEMINI_API_KEY` | Message generation (Gemini 2.5 Flash) |
| `OPENAI_API_KEY` | Predictions + AI features |

---

## Architecture Decisions

- **Why Vercel for crons?** Mac mini has repeated kernel panics on macOS Tahoe 26.3. User-facing agents must not depend on local hardware.
- **Why scrape.do instead of Playwright?** Playwright can't run on Vercel serverless. scrape.do handles JS rendering + Cloudflare bypass via API.
- **Why Neon for state?** Vercel functions are stateless — all persistent state (notification dedup, tracking, intel) lives in Neon Postgres.
- **Why Gemini for message generation?** Fast, cheap, good quality for short cycling content. Model: `gemini-2.5-flash-lite`.
- **No local file writes** in any Vercel route — everything goes to DB or external APIs.
