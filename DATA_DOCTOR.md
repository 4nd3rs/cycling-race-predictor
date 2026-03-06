# PCP Data Doctor — Agent State
<!-- Max 50 lines. Trim old entries when approaching limit. -->

## Last run
2026-03-06 ~22:01 Stockholm

## RESOLVED — DO NOT RE-RAISE
- Paris-Nice W + Tirreno-Adriatico W: DELETED (phantom races, Anders confirmed)
- 188 phantom women's races purged (2026-03-05)
- OHN M / OHN W: results fixed ✅ (2026-03-05)
- Beobank Samyn Ladies M/W: completed with results ✅
- VTT Chabrières M+W: results manually inserted ✅ (2026-03-06)
- Phantom men gender fields fixed by Anders (1f98a9d1, c1509990, 3d73f83c → now gender=women)
- Site HTTP 500 at 16:01 → recovered ✅
- Gran Premio Zaragoza XCO M+W: dropped — data source gap confirmed

## Active issues

### [ASK ANDERS — asked 12:01 + 16:01 + 18:01 + 20:01 + 22:01] Duplicate women entries
→ `trofeo-oro-in-euro-womens-bike-race`: races c1509990 + 10a385be both women, 0 startlist
→ `porec-classic-ladies`: races 3d73f83c + 6bac176c both women, 0 startlist
→ `porec-classic` also has women entry 70abc9e2 → 3 women entries for Poreč?
→ `vuelta-a-extremadura-femenina`: races 1f98a9d1 + 696455f5 BOTH women, same date, 0 startlist
→ All 4 cases: OK to DELETE the extra/phantom rows?

### [ASK ANDERS — 3rd run] Bolivia National Championship Road Race (Feb 28): 0 results
→ Race ID: a8b04ec5 | status=active | 6+ days post-race, still no results
→ Low-profile race, no startlist, road. Data source may not cover it. OK to mark completed with no results?

### [WATCH — 3rd run] BIWASE Tour of Vietnam M (Mar 4): 0 results, ongoing stage race
→ Stage race in progress, expected until ~Mar 12. Monitor until then.

### [WATCH] BIWASE Cup (Mar 10): 0 startlist. Monitor until ~Mar 10.

### [NOTE] Italia Bike Cup Albenga (Mar 7 — today): partial predictions
→ W: 17 starters / 3 predictions | M: 53 starters / 8 predictions
→ MTB — may be intentional (top-N only?) or partial run. Not fixing without clarity.

### [WATCH] Stale 2025 road races (19 races, 271-411d overdue)
→ Not urgent. Flag for Anders if he wants to backfill.

## Healthy upcoming races (checked 22:01, 2026-03-06)
- Strade Bianche M (Mar 7 — tomorrow): 71 startlist + 71 predictions + 44 news ✅
- Strade Bianche W (Mar 7 — tomorrow): 45 startlist + 45 predictions + 44 news ✅
- Ster van Zwolle M (Mar 7): 172 startlist + 172 predictions ✅
- Paris-Nice M (Mar 8): 153 startlist + 153 predictions ✅
- Tirreno-Adriatico M (Mar 9): 83 startlist + 83 predictions ✅

## Recent fixes
- 2026-03-06 10:01: Phantom men races gender-corrected by Anders ✅
- 2026-03-05 18:01: OHN W → 135 results inserted ✅
