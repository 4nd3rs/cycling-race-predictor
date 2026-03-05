# PCP Data Doctor — Agent State
<!-- Max 50 lines. Trim old entries when approaching limit. -->

## Last run
2026-03-05 ~12:01 Stockholm

## Active issues

### [CRITICAL — AWAITING ANDERS] Paris-Nice W + Tirreno-Adriatico W = PHANTOM RACES
- f2fdb0e3 (Paris-Nice W) — 0 startlist, pcs_url=paris-nice-femmes/2026
- c259eb66 (Tirreno-Adriatico W) — 0 startlist, pcs_url=tirreno-adriatico-donne/2026
→ Asked Anders multiple times. Waiting: delete or disable these records.

### [AWAITING ANDERS] Faun Drome Classic W — wrong pcs_url
- 870aacb5 — pcs_url = men's URL (la-drome-classic/2026), -dames/-femmes tried → HTTP 000
→ Waiting for Anders: correct PCS URL?

### [MINOR — AWAITING ANDERS] Salverda Bouw Ster van Zwolle W — likely phantom
- 55cb9868 — gender=women, pcs_url same as men's race
→ Ask Anders if should be removed.

### [WATCH #1] Le Samyn M (race c498bdc7, Mar 3) — 171 startlist, only 5 results
→ Added this run. Check next run; if still <10, run scrape-results --race-id c498bdc7.

### [WATCH #1] Omloop Het Nieuwsblad M (race 2890d292, Feb 28) — 175 startlist, only 2 results
→ Added this run. Check next run; if still <10, run scrape-results --race-id 2890d292.

## scrape.do status
- 2026-03-05 12:01: Site HTTP 200 ✅

## Healthy upcoming races
- Strade Bianche M (Mar 7): 71 startlist + 71 predictions ✅ 22 news ✅
- Strade Bianche W (Mar 7): 45 startlist + 45 predictions ✅ 22 news ✅
- Ster van Zwolle M (Mar 7): 172 startlist + 172 predictions ✅ 1 news ✅
- Paris-Nice M (Mar 8): 84 startlist + 84 predictions ✅ 10 news ✅
- Tirreno-Adriatico M (Mar 9): 70 startlist + 70 predictions ✅ 6 news ✅

## Missing results (expected — null pcs_url or MTB)
- VTT Chabrières M/W (Feb 28): MTB, null pcs_url
- Gran Premio Zaragoza XCO M/W (Feb 28): MTB, null pcs_url
- BIWASE Tour of Vietnam M (Mar 4): null pcs_url
- National Championships Bolivia M (Feb 28): null pcs_url

## Recent fixes
- 2026-03-05 12:01: scrape-results Trofeo Laigueglia M (c2514259) → 158 results inserted ✅
- 2026-03-05 10:01: scrape-race-news Ster van Zwolle M → 3 articles (hub 404, limited)
- 2026-03-05 08:01: generate-predictions Ster van Zwolle M (a738096d) → 172 predictions ✅
- 2026-03-04 20:01: scrape-results Hageland M (9481e288) → 160 results ✅

## Notes
- Pattern: some races marked "completed" with only 2-5 results (parse timing issue?)
- Kuurne (174✅), Hageland (160✅) scraped fine; Le Samyn + OHN only 2-5
- Women's PCS URLs: -donne, -femmes, -we, -ladies depending on race
- MTB races with null pcs_url — expected, no action
