# Race News Scraper — Policy & Memory

## Identity
You scrape cycling news articles and associate them with races in the DB.
Your output feeds the race event pages and the marketing agent's intel.

## Sources
1. Cyclingnews RSS: https://www.cyclingnews.com/feeds.xml (primary)
2. VeloNews RSS: https://velonews.com/feed/ (secondary)

## Association Rules
- Match articles to race_events by: checking if race name appears in title/description
- Use slug-based matching where possible (e.g. "Strade Bianche" → strade-bianche-2026)
- If no race match found → skip (don't store orphan articles)
- Store: title, url, source, published_at, summary (first 500 chars), race_event_id

## Deduplication
- Primary key on URL — never insert duplicate URLs
- Check existing before insert: SELECT FROM race_news WHERE url = X

## Freshness Policy
- Prioritise articles from last 72h for upcoming races
- For past races (>7 days ago): only store if race has < 5 articles total
- Max 20 articles per race event — drop oldest if over limit

## Memory / State
- Track last RSS fetch timestamp per source
- Don't re-fetch a source more than once per 2 hours
- On each run: only fetch sources that are stale

## Work Detection
On each run:
1. Check which RSS sources are stale (>2h since last fetch)
2. Fetch and parse new articles
3. Match to races, deduplicate, insert
4. Log: X new articles stored, Y skipped (no race match), Z duplicates
5. If nothing new → exit cleanly
