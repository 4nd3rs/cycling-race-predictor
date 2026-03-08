# PCP Cron Jobs — Disabled (2026-03-08)

All jobs ran against `~/cycling-race-predictor` on the Mac mini.
Timezone: `Europe/Stockholm`. Session: `isolated`.

---

## WhatsApp Road Agents

All road agent jobs run: `cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/whatsapp-road-agent.ts <mode>`

| Name | Schedule | Mode | Notes |
|------|----------|------|-------|
| 📱 WA Road — Breaking News | Every 2h, 08:00–22:00 (`0 */2 8-22 * * *`) | `breaking` | Posts only if urgent news (injuries, withdrawals) |
| 📱 WA Road — Race Day | Daily 08:00 | `raceday` | Hype post for races happening today |
| 📱 WA Road — Daily News | Daily 12:00 | `news` | Today's most interesting road intel |
| 📱 WA Road — Race Preview | Daily 18:00 | `preview` | Preview for races in next 48h |
| 📱 WA Road — Results | Daily 19:00 | `results` | Podium results for races today/yesterday |

---

## WhatsApp MTB Agents

All MTB agent jobs run: `cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/whatsapp-mtb-agent.ts --mode <mode>`

| Name | Schedule | Mode | Notes |
|------|----------|------|-------|
| 🚵 MTB WA — Weekly News | Monday 10:00 | `news` | Weekly MTB news digest |
| 🚵 MTB WA — Race Preview (Fri) | Friday 18:00 | `preview` | Weekend race preview |
| 🚵 MTB WA — Race Preview (Sat) | Saturday 18:00 | `preview` | Saturday race preview |
| 🚵 MTB WA — Race Day | Saturday + Sunday 09:00 | `raceday` | Race day hype |
| 🚵 MTB WA — Results | Saturday + Sunday 20:00 | `results` | Podium results |

**WA Groups:**
- Road: `120363425402092416@g.us`
- MTB: `120363405998540593@g.us`

---

## WA Group Admin

```
cd ~/cycling-race-predictor && node_modules/.bin/tsx scripts/agents/wa-group-admin.ts
```

| Name | Schedule | Notes |
|------|----------|-------|
| 🛡️ WA Group Admin Check | Daily 10:00 | Warns/kicks non-cycling members from WA groups |

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
