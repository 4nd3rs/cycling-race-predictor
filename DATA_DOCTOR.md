# PCP Data Doctor — Agent State
<!-- Max 50 lines. Trim old entries when approaching limit. -->

## Last run
2026-03-06 ~16:01 Stockholm

## RESOLVED — DO NOT RE-RAISE
- Paris-Nice W + Tirreno-Adriatico W: DELETED (phantom races, Anders confirmed)
- 188 phantom women's races purged (2026-03-05)
- OHN M / OHN W: results fixed ✅ (2026-03-05)
- Beobank Samyn Ladies M/W: completed with results ✅
- VTT Chabrières M+W: results manually inserted ✅ (2026-03-06)
- Phantom men gender fields fixed by Anders (1f98a9d1, c1509990, 3d73f83c → now gender=women)

## Active issues

### [CRITICAL — ALERTED 16:01] Site HTTP 500
→ procyclingpredictor.com returned 500 at 16:01. Monitor next run.

### [ASK ANDERS — asked 12:01, re-asked 16:01] Duplicate women entries after phantom gender fix
→ `trofeo-oro-in-euro-womens-bike-race`: race c1509990 + 10a385be both women, 0 startlist
→ `porec-classic-ladies`: race 3d73f83c + 6bac176c both women, 0 startlist
→ `porec-classic` also has women entry 70abc9e2 → 3 women entries for Poreč?
→ `vuelta-a-extremadura-femenina`: race 1f98a9d1 + 696455f5 BOTH women, same date, 0 startlist/results
→ All 4 cases: OK to DELETE the extra/phantom rows?

### [WATCH — 5th run] Gran Premio Zaragoza XCO M+W (Feb 28): 0 results
→ xcodata "No results available" — 6+ days post-race. Asked Discord 10:01 + 16:01.

### [WATCH] BIWASE Tour of Vietnam M (Mar 4): 0 results, ongoing stage race
→ BIWASE Cup (Mar 10) also has 0 startlist. Monitor until ~Mar 12.

### [WATCH] Stale 2025 road races (19 races, 271-411d overdue)
→ Not urgent. Flag for Anders if he wants to backfill.

## scrape.do status
- 2026-03-06 16:01: Site HTTP 500 🚨 (was 200 at 14:01)

## Healthy upcoming races (checked 16:01)
- Strade Bianche M/W (Mar 7): 71+45 startlist + predictions ✅
- Ster van Zwolle M (Mar 7): 172 startlist + predictions ✅
- Paris-Nice M (Mar 8): 153 startlist + predictions ✅
- Tirreno-Adriatico M (Mar 9): 83 startlist + predictions ✅

## Recent fixes
- 2026-03-06 10:01: Phantom men races gender-corrected by Anders ✅
- 2026-03-05 18:01: OHN W → 135 results inserted ✅
