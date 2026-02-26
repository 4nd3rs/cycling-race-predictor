# Content Sources — Pro Cycling Predictor

> Maintained by AMA. Updated when sources are added/removed/changed.  
> These are the authoritative lists used by all scraping and digest agents.

---

## Road Cycling — RSS Feeds

| Source | URL | Frequency | Notes |
|--------|-----|-----------|-------|
| Cyclingnews | `https://www.cyclingnews.com/feeds.xml` | Every digest run | 50-item feed, images via enclosure. Best general road coverage. |
| INRNG (Inner Ring) | `https://inrng.com/feed/` | Every digest run | Deep analysis, fewer posts but high quality. Road only. |
| Rouleur Journal | `https://www.rouleur.cc/blogs/the-rouleur-journal.atom` | Morning digest only | Editorial/magazine. Slow cadence, high quality. |

---

## MTB — RSS Feeds

| Source | URL | Frequency | Notes |
|--------|-----|-----------|-------|
| *(none confirmed accessible)* | — | — | Pinkbike, VitalMTB, BikeRumor all Cloudflare-blocked. Use Google News instead. |

> **Note:** For MTB, rely on Google News RSS queries (see below). Cyclingnews also covers XCO/XCC results.

---

## Google News RSS — Dynamic Queries

Google News aggregates from dozens of sources (Pinkbike, VeloNews, CyclingTips, BikeRumor, CyclingWeekly, etc.) and exposes clean RSS. Use these for broad multi-source coverage.

Base URL: `https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=`

| Query slug | Topic | Used by |
|-----------|-------|---------|
| `professional+cycling+road+race+UCI+2026` | General road racing | Morning + evening digest |
| `UCI+mountain+bike+XCO+World+Cup+2026` | MTB XCO | Morning + evening digest |
| `cycling+spring+classics+cobbles+2026` | Classics (seasonal, ~Feb–Apr) | Midday digest |
| `cycling+grand+tour+2026` | Grand Tours (seasonal, ~May–Oct) | Morning + evening digest |
| `cycling+transfer+contract+signing+rider` | Transfers & contracts | Evening digest |
| `cyclist+injury+withdrawal+DNS+DNF+2026` | Injuries & withdrawals | Every digest run (alerts) |
| `XCO+XCC+MTB+mountain+bike+race+results` | MTB race results | Every digest run during MTB season |
| `pro+cycling+rider+team+news+peloton` | General peloton buzz | Morning digest |

> **Seasonal note:** Activate classics query Feb–Apr; Grand Tour query May–Oct; keep injury query always active.

---

## Race-Specific News (used by scrape-race-news.ts)

For each upcoming race event, the scraper builds dynamic Google News queries:
- `"[event name]" cycling 2026` 
- `"[event name]" race preview results`

Combined with:
- Cyclingnews RSS filtered by race keywords
- Cyclingnews race hub page: `cyclingnews.com/pro-cycling/races/[slug]-[year]/`
- INRNG feed filtered by race keywords

---

## Sources — Blocked / Unavailable (as of 2026-02-26)

| Source | Reason |
|--------|--------|
| VeloNews (`velonews.com/feed/`) | Cloudflare |
| PinkBike (`pinkbike.com/news/rss.xml`) | Cloudflare |
| BikeRumor (`bikerumor.com/feed/`) | Cloudflare |
| CyclingTips (`cyclingtips.com/feed/`) | Cloudflare |
| VitalMTB (`vitalmtb.com/news/rss`) | Returns HTML / blocked |

> These are still reachable via Google News aggregation.

---

## Gossip / Rider Intelligence Sources

The Gossip Hunter agent searches Google News for:
- `"[rider name]" injury 2026`
- `"[rider name]" transfer team 2026`
- `"[rider name]" form fitness race`

Classifies into: **injury / transfer / form / team_dynamics / other**  
Sentiment scored and summarised via Claude Haiku.

---

## Digest Schedule (cron)

| Time (Stockholm) | Digest type | Feeds used |
|-----------------|-------------|------------|
| **07:30** | Morning — overnight news | All RSS + injury + MTB Google News |
| **13:00** | Midday — race-day pulse | Injury alerts + road Google News |
| **20:00** | Evening — end of day | All RSS + transfers + MTB Google News |

Digest posts to **#pcp-content** Discord channel.  
Race-specific news scraped separately every 4h (→ `race_news` DB table).

---

## Update Log

| Date | Change |
|------|--------|
| 2026-02-26 | Created. Added inrng, Rouleur, Google News queries. Documented all Cloudflare-blocked sources. |
