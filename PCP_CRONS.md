# PCP Cron Jobs — Migrated to Vercel (2026-03-08)

All Mac mini cron jobs have been migrated to Vercel cron routes.
Gateway: Fly.io WhatsApp gateway (`OPENCLAW_GATEWAY_URL`).

---

## WhatsApp Groups — Vercel Cron

**Route:** `/api/cron/whatsapp-groups` — runs every 2h (`:15`)
**Covers both Road and MTB groups.**

| Type | Road | MTB | Dedup key |
|------|------|-----|-----------|
| Preview (1-2 days ahead) | ✅ WorldTour + followed | ✅ Elite WC/C1/HC | `wa-preview` per race |
| Raceday (today) | ✅ | ✅ | `wa-raceday` per race |
| Results (last 2 days) | ✅ | ✅ | `wa-result` per race |
| News digest | ✅ Daily ~12:00 UTC | ✅ Mondays ~10:00 UTC | `wa-news` per day |
| Breaking news | ✅ From riderRumours DB | — | `wa-breaking` per rider per day |

**WA Groups:**
- Road: `120363425402092416@g.us`
- MTB: `120363405998540593@g.us`

---

## WA Group Admin — Vercel Cron

**Route:** `/api/cron/wa-group-admin` — runs daily at 10:00 UTC
- Checks group members against registered users
- Sends DM warnings to unregistered members (max 1/day)
- Sends admin report to Anders via WA DM

---

## PCP Daily QA Report

| Name | Schedule | Delivery |
|------|----------|----------|
| PCP Daily QA Report | Daily 05:00 | Posts to Discord #pcp-qa (channel `1477074815281139872`) |

**What it does:**
1. Finds upcoming races from DB
2. Fetches key pages via scrape.do (no Playwright): homepage, /races/road, /races/mtb, event hub, category/predictions page
3. Reviews for regressions, missing content, errors
4. Scans code for Playwright usage (🚨 alert if found)
5. Writes reports to `/Users/amalabs/.openclaw/workspace/reports/`

**scrape.do token:** `ad2aaefc1bf54040b26b4cdc9f477f7792fa8b9ca31`

---

## Older Crons (disabled before Mar 8, not in final list)

These were killed during the first crash investigation (Mar 3). Scripts exist but crons were already gone.

| Name | Script | Schedule |
|------|--------|----------|
| 📅 Race Calendar Sync | `sync-race-calendar.ts` | Daily 06:00 |
| 📰 Gossip Hunter | `gossip-hunter.ts` | Daily 08:00 |
| 📊 Road UCI Sync | `sync-road-uci.ts` | Tuesday 14:00 |
| 🏁 Results Hunter | `results-hunter.ts` / `scrape-results.ts` | Every 6h |
| 📋 Startlist Sync | `sync-startlists.ts` | Every 1h |
| 📸 Marketing Agent (Telegram) | `marketing-agent.ts` | Daily 09:00 — **BROKEN, do not re-add** |

⚠️ All scripts above used Playwright — must be rewritten before re-enabling.

---

## Key Config

- **Repo:** `~/cycling-race-predictor`
- **Run scripts from project dir:** `cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/X.ts`
- **DB:** Neon Postgres — credentials in `.env.local`
- **No Playwright allowed** — kills the Mac mini under load
- **scrape.do** for JS-rendered pages (token in `.env.local` as `SCRAPE_DO_TOKEN`)
- **OpenClaw gateway** must be running for WA/Telegram delivery
- **Instagram:** `scripts/agents/post-to-instagram.ts` — posting paused

---

## WA Agent Delivery (via OpenClaw)

Jobs use `message` tool internally (channel=whatsapp, action=send). The OpenClaw gateway must be running and WhatsApp connected for delivery to work.
