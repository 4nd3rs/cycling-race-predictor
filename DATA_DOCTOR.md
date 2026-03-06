# PCP Data Doctor — Agent State
<!-- Max 50 lines. Trim old entries when approaching limit. -->

## Last run
2026-03-06 ~10:01 Stockholm

## RESOLVED — DO NOT RE-RAISE
- Paris-Nice W + Tirreno-Adriatico W: DELETED (phantom races, Anders confirmed)
- 188 phantom women's races purged (2026-03-05)
- OHN M / OHN W: results fixed ✅ (2026-03-05)
- Beobank Samyn Ladies M/W: completed with results ✅
- VTT Chabrières M+W: results manually inserted ✅ (2026-03-06)

## Active issues

### [ASK ANDERS] Gran Premio Zaragoza XCO M+W (Feb 28): 0 results
→ xcodata "No results available" — 6+ days post-race, 3rd+ consecutive run
→ Men (37cf7089): 5 startlist. Women (1f09aa1a): 5 startlist
→ Asked in Discord 10:01. OK to mark cancelled / no-results?

### [ASK ANDERS] Suspected phantom M entries in women's events (new, 10:01)
→ Pattern matches the 188 phantoms purged on Mar 5 — men's race in women-named events:
→ `vuelta-a-extremadura-femenina` → race 1f98a9d1 gender=men
→ `trofeo-oro-in-euro-womens-bike-race` → race c1509990 gender=men
→ `porec-classic-ladies` → race 3d73f83c gender=men
→ Asked in Discord 10:01. Delete these?

### [WATCH] BIWASE Tour of Vietnam M (Mar 4): 0 results, 0 startlist
→ Stage race, likely still ongoing. Also listed as "BIWASE Cup" (Mar 10). Monitor until ~Mar 12.

### [WATCH] Stale 2025 road races (19 races, 270-410d overdue)
→ Not urgent. Flag for Anders if he wants to backfill.

## scrape.do status
- 2026-03-06 10:01: Site HTTP 200 ✅

## Healthy upcoming races (checked 10:01)
- Strade Bianche W (Mar 7): 45 startlist + predictions, 31 news ✅
- Strade Bianche M (Mar 7): 71 startlist + predictions, 31 news ✅
- Ster van Zwolle M (Mar 7): 172 startlist + predictions, 1 news ✅
- Paris-Nice M (Mar 8): 84 startlist + predictions, 10 news ✅
- Tirreno-Adriatico M (Mar 9): 70 startlist + predictions, 6 news ✅

## Recent fixes
- 2026-03-05 18:01: OHN W → 135 results inserted ✅
- 2026-03-05 16:01: OHN M → 173 results ✅
- 2026-03-05 14:01: Le Samyn M → 166 results ✅
