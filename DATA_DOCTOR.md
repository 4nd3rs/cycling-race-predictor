# PCP Data Doctor — Agent State
<!-- Max 50 lines. Trim old entries when approaching limit. -->

## Last run
2026-03-03 22:18 Stockholm

## Active issues
- Trofeo Laigueglia **women** (2026-03-04) — 166 startlist, 0 predictions. Fix next run.
- Strade Bianche men+women (2026-03-07) — 71 startlist, 0 predictions. Within 3-day window next run.
- Paris-Nice men (2026-03-08) — 84 startlist, 0 predictions. Monitor.
- Ename Samyn Classic (2026-03-03) — had startlist, 0 predictions. Race likely done; no fix taken.
- Missing results (Beobank Samyn Ladies, Faun Drome Classic, Gran Premio Zaragoza XCO,
  FENIX-EKOÏ Omloop van het Hageland) — all 2026-02-28 to 2026-03-02, 0 results.
  If still 0 next run, may indicate scraper parse error. WATCH.
- Scrape.do credits API returned Access Denied — cannot check credits.

## Watch list
- Missing results for Beobank Samyn Ladies (f4bb7a7f + 169267df) — 2026-03-02, watch across 2 runs
- Faun Drome Classic (870aacb5 + 4bf7688a) — 2026-02-28, watch across 2 runs
- FENIX-EKOÏ Omloop van het Hageland — 2026-02-28, watch across 2 runs

## Recent fixes
- 2026-03-03: Generated predictions for Trofeo Laigueglia MEN (race_id: c2514259) — 165 predictions saved ✅
  (Women's fix deferred to next run — one fix per run rule)

## Notes
- `r.completed` column does not exist in schema — don't use it in SQL queries
- Scrape.do credits endpoint returns "Access Denied" regardless of token — ask Anders about correct endpoint
