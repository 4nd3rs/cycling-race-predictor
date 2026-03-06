# MTB Results Sources — Knowledge Base
<!-- Updated by AMA as new sources are discovered. Used by Data Doctor + results agents. -->

## The Problem
UCI PDFs are behind a redirect loop (no public download without auth).
xcodata.com is the canonical XCO database but lags 3–10 days after races.
Full results are usually only on the **organizer website** or their **timing system**.

## How to Find Results for a Race
1. **xcodata.com** — check `/race/{id}/` — if "No results available yet", it's not published
2. **Search web** — `"{race name}" {year} résultats classement élite` (French for French races)
3. **Organizer website** — see known sources below
4. **UCI competition page** — `uci.org/competition-details/{year}/MTB/{competitionId}` — event codes visible in HTML, but PDFs are auth-gated
5. **Timing platforms** — see below

---

## Known Timing Platforms

### my.raceresult.com
- Used by: French MTB events (Coupe de France series, some internationals)
- API: requires `key` param — not publicly accessible without the event key
- Example: `https://my.raceresult.com/156547/` (Coupe de France XCO grid classification 2026)
- How to get key: visible in source of the event page or shared by organizer

### sportsnconnect.com
- Used by: French FFC-affiliated races (VTT Chabrières, others)
- Results tab visible on event page after race
- URL pattern: `https://www.sportsnconnect.com/calendrier-evenements/view/{id}/{race-slug}`
- Fetching: requires JS rendering (React app)

### ffc.fr results (maj.ffc.fr)
- French Federation — `https://maj.ffc.fr/a_Vtt/Resultats_classements/index2.asp`
- Lists French national-level XCO results
- Unreliable fetching (often times out)

### Swiss Cycling / German timing (MTB Cup)
- TBD

---

## Known Race Sources

### VTT Chabrières (Guéret, France) — UCI C1
- **xcodata ID:** 9241 (2026), check `/race/9241/`
- **Organizer:** Creuse Oxygène — https://www.creuse-oxygene.com/actualites/
  - Publishes a news post with top-3 results within 2–3 days of race
  - 2026 post: https://www.creuse-oxygene.com/actualites/ (look for "Les infos du {date}")
- **Timing:** sportsnconnect.com (registration) — full results TBD
- **UCI page:** https://www.uci.org/competition-details/2026/MTB/77550
  - Event codes: D2EV370338 (Men Elite), D2EV370339 (Men Junior), D2EV370340 (Women Elite), D2EV370341 (Women Junior)
- **2026 results (manually inserted):**
  - Men Elite: 1. Lillo Dario (SUI), 2. Jens Schuermans (BEL)
  - Women Elite: 1. Gérault Léna (FRA, SCOTT Creuse Oxygène)
- **Next edition:** Coupe de France round at same venue, Apr 17–19 2026

### Gran Premio Zaragoza XCO (Spain) — UCI C1
- **xcodata ID:** 9240 (2026), check `/race/9240/`
- **Status:** "No results available yet" as of Mar 6 — 6+ days post race (Feb 28)
- **Organizer source:** TBD — search `"Gran Premio Zaragoza" XCO 2026 resultados`

### Internacionales Chelva XCO (Spain) — UCI C1
- **xcodata ID:** TBD
- **2026 results:** Anne Terpstra (W), Luca Schwarzbauer (M) — source: pinkbike.com
- **Note:** pinkbike.com covers Spanish C1 races well

---

## General Lessons

### French C1 races
- Results: sportsnconnect.com or organizer news post within 2–3 days
- Search: `"{race}" résultats classement élite hommes femmes {year}`
- Organizer often posts on their club website (e.g. creuse-oxygene.com)

### Spanish C1 races  
- Results: often on pinkbike.com, enduro/mtb Spanish federation sites
- Search: `"{race}" XCO 2026 resultados elite`

### UCI World Cup (WC class)
- Results: pinkbike.com (same day), red-bull.com, uci.org race hub
- xcodata: usually published within 24h

### UCI Continental Series (CS class)
- Results: xcodata within 2–5 days, sometimes national federation sites

### General rule
- Races with > 5 days delay → search organizer website first
- Never rely on UCI PDFs (auth-gated)
- pinkbike.com is the best English-language source for WC/WCH races
- For local/national races, the FFC (France), RFEC (Spain), Swiss Cycling etc. websites

---

## UCI Event Code Lookup
Codes are embedded in `uci.org/competition-details/{year}/MTB/{competitionId}` page HTML.
Pattern: `D2EV######` — one per category (Men Elite, Women Elite, Juniors, etc.)
PDFs at `www.uci.org/docs/default-source/world-mtb-xco-{year}/{code}.pdf` redirect to
`archive.uci.org` which also redirects — **not accessible without UCI login**.

---

_Last updated: 2026-03-06 by AMA_
