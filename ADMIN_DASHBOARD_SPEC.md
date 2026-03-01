# Admin Dashboard — Requirements & Design Spec
## procyclingpredictor.com

---

## Overview
Rebuild the admin dashboard at `/admin` as a comprehensive ops centre for the Pro Cycling Predictor platform. No action buttons — read-only status and monitoring. Anderson manages everything via AMA in Discord.

The dashboard lives inside the existing Next.js app at `src/app/admin/`. It uses the existing layout, Tailwind v4, shadcn/ui components, and Drizzle ORM. All data server-side rendered (force-dynamic). Auth gate via `isAdmin()` from `@/lib/auth`.

---

## Navigation

Sidebar or tab-based nav with 5 sections:
1. **Overview** — `/admin` (current landing)
2. **Pipeline** — `/admin/pipeline`
3. **Predictions** — `/admin/predictions`
4. **Data Quality** — `/admin/data-quality`
5. **Users** — `/admin/users`

Keep the existing layout.tsx; add nav links to the sidebar/header there.

---

## Section 1: Overview (`/admin`)

A quick health snapshot — one glance tells you if everything is OK.

### Cards (top row)
- **Races** — total races in DB, how many this week, how many have results, how many are stale (past + no results)
- **Riders** — total riders, how many have ELO score, how many have bio/photo
- **Predictions** — total predictions generated, how many races have predictions for next 7 days
- **Users** — total registered users, active last 30 days, Telegram subscribers, WhatsApp subscribers

### Pipeline health strip
A status row for each pipeline component showing last-run time + status badge:
- 📅 Race Calendar (last sync, races added)
- 📋 Startlists (last sync, riders added)
- 🏁 Road Results (last run, results imported)
- 🏁 MTB Results (last run, results imported)
- 🔮 Predictions (last run)
- 📣 Marketing (last post)
- 🏆 UCI Rankings (last sync)

Source: read `SCRAPE_STATUS.md` JSON blob from project root + `uci_sync_runs` table.

### Upcoming races (next 7 days)
Table: name | date | discipline | has startlist? | has predictions? | has results?

---

## Section 2: Pipeline (`/admin/pipeline`)

Deep dive into each pipeline component.

### Scrape Credits (top card)
- Show current scrape.do usage if available
- Estimated monthly usage at current rate
- Note: "XCOdata uses plain fetch (free) — scrape.do only for PCS results"

### Race Calendar
- Last sync timestamp
- Races by discipline + category counts
- Races added in last 7 days (list)

### Startlists
- Last sync timestamp
- Races with startlists vs without (for upcoming races)
- Coverage % for races in next 14 days
- List of upcoming races missing startlists (name | date | pcsUrl?)

### Results
- Last road results run
- Last MTB results run
- Results imported in last 7 days (race | count | status)
- Stale races — past races with no results (list, limited to 20)

### ELO / Rankings
- Last UCI sync run (from `uci_sync_runs`)
- ELO history — most recent batch of ELO updates (from `elo_history` table, last 24h)
- Riders with no ELO score

---

## Section 3: Predictions (`/admin/predictions`)

### Summary cards
- Total predictions in DB
- Races with predictions this week
- Races without predictions in next 7 days (alert if > 0)

### Prediction quality table
For each race in the next 14 days:
- Race name | date | discipline
- Has predictions? (yes/no + count)
- Startlist size
- Prediction freshness (generated_at)
- Status badge: ✅ ready | ⚠️ stale (>24h old) | ❌ missing

### Recent prediction runs
Last 10 prediction batches from `predictions` table (group by generated_at, show race count + top pick per race)

---

## Section 4: Data Quality (`/admin/data-quality`)

Surfaces data problems that affect prediction accuracy.

### Rider coverage
- Total riders in DB
- Riders with UCI ranking: X / total (%)
- Riders with bio: X / total (%)
- Riders with team assigned: X / total (%)
- Riders with no ELO history (never raced in system)

### Race data issues
- Races missing pcs_url (upcoming only, next 30 days) — table: name | date | category
- Races with pcs_url 404 (if detectable) — from any stored scrape errors
- Races with < 3 results (imported but suspicious) — might be partial scrapes
- Duplicate race names (if any)

### News coverage
- Race news by event (upcoming races, `race_news` table): event | article count | last article date
- Events with 0 articles in next 7 days

### Rumours / gossip
- Total active rumours from `rider_rumours`
- Rumours by confidence level
- Most recent 10 rumours (rider | sentiment | source | created_at)

---

## Section 5: Users (`/admin/users`)

### Summary cards
- Total registered users (from `users` table)
- Users signed up last 7 days
- Users signed up last 30 days
- AI chat sessions (total, last 7 days) from `ai_chat_sessions`

### Notification subscribers
- Telegram subscribers: count from `user_telegram`
- WhatsApp subscribers: count from `user_whatsapp`
- Notification log: last 20 notifications sent (from `notification_log`) — user | type | sent_at | status

### Top engaged users
Users with most tips submitted (`user_tips` table) — user_id | username | tip count | last tip date
Note: don't show personal data, just aggregate engagement metrics

### Discussion activity
- Discussion threads: total, last 7 days
- Discussion posts: total, last 7 days

---

## Design Guidelines

- Use existing shadcn/ui components: `Card`, `Badge`, `Table`
- Status badges: green = ok/has data, yellow = warn/missing, red = error/stale
- Keep it dense — this is a dashboard, not marketing. Small text, tight spacing.
- Dark/light mode already works via existing theme — don't break it
- No client-side components unless absolutely necessary (keep SSR)
- Data freshness note at bottom of each page: "Data as of [timestamp]"
- Responsive — should work on a laptop browser

---

## File Structure

```
src/app/admin/
  layout.tsx          ← update with nav links
  page.tsx            ← Section 1: Overview (rewrite)
  pipeline/
    page.tsx          ← Section 2: Pipeline
  predictions/
    page.tsx          ← Section 3: Predictions
  data-quality/
    page.tsx          ← Section 4: Data Quality
  users/
    page.tsx          ← Section 5: Users
```

Also need API route or server action to read SCRAPE_STATUS.md:
```
src/app/api/admin/scrape-status/route.ts
```

---

## Technical Notes

- `SCRAPE_STATUS.md` is at project root — read with `fs.readFileSync` in a server component or API route
- scrape.do credit tracking: no API for current balance — show a note to check manually at scrape.do dashboard
- Clerk user data: use `users` table in DB (synced from Clerk webhooks), NOT Clerk API directly
- All DB queries via Drizzle ORM using `db` from `@/lib/db`
- Import schema tables from `@/lib/db` or `@/lib/db/schema` (both work)
- ELO history table: `eloHistory` from schema
- Notification log: `notificationLog` from schema
