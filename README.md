# Cycling Race Predictor

Predicts cycling race results using a TrueSkill ELO rating system. Supports road and MTB (XCO) disciplines.

## Tech Stack

- **Framework**: Next.js 16 (Turbopack)
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Auth**: Clerk
- **Styling**: Tailwind CSS + shadcn/ui
- **Deployment**: Vercel

## Data Sources

- **XCOdata** — Complete UCI MTB XCO rankings (primary source for MTB riders)
- **UCI DataRide** — Official UCI rankings (supplementary age/UCI ID data, requires Firecrawl API key)
- **ProCyclingStats** — Road cycling startlists and results
- **Rockthesport / Cronomancha** — Regional MTB event data (Spain)

## Getting Started

```bash
npm install
cp .env.example .env.local  # Fill in your env vars
npm run dev
```

### Environment Variables

- `DATABASE_URL` — Neon PostgreSQL connection string
- `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `CRON_SECRET` — Secret for authenticating cron job requests
- `FIRECRAWL_API_KEY` — (Optional) For scraping UCI DataRide for rider ages

### Database Migrations

Migrations are in `drizzle/migrations/`. To push schema changes:

```bash
npm run db:push
```

Or run a specific migration manually via the Neon SQL console.

## Key Features

### ELO Rating System
Riders are rated using a TrueSkill-based ELO system. Ratings update after each race based on finishing positions. New riders get an initial ELO estimate from their UCI ranking points.

### UCI Rankings Sync
The system mirrors the complete UCI MTB rankings database. This provides rider data (name, nationality, team, UCI points) and initial ELO estimates for all ranked riders.

- **Admin dashboard** (`/admin`): View sync history and trigger manual syncs
- **Automatic sync**: Runs every Tuesday at 10:00 UTC via Vercel cron (UCI updates on Tuesdays)
- **Flow**: Sync once → all ranked riders exist in DB → startlist imports match against them

### Rider Matching
Centralized matching logic (`src/lib/riders/find-or-create.ts`) prevents duplicate riders:
1. Match by XCO ID (exact)
2. Match by UCI ID (exact)
3. Match by PCS ID (exact)
4. Match by name (case-insensitive)
5. Match by accent-stripped name
6. Create new rider if no match

Partial unique indexes on `riders.xco_id` and `riders.uci_id` enforce uniqueness at the DB level.

### Race Predictions
For each race, the system generates predictions based on:
- ELO rating (primary signal)
- UCI ranking points
- Form (recent results)
- Profile affinity (course characteristics)
- Community tips/rumours

## Admin

The admin dashboard at `/admin` is accessible to users with the admin email (`a@andmag.se`). It provides:
- UCI sync status and history
- Per-category sync breakdown
- Manual "Sync Now" trigger

## Project Structure

```
src/
├── app/
│   ├── admin/              # Admin dashboard
│   ├── api/
│   │   ├── admin/          # Admin API routes
│   │   ├── cron/           # Scheduled jobs
│   │   ├── events/         # Event management
│   │   └── races/          # Race management
│   ├── races/              # Race pages
│   ├── riders/             # Rider pages
│   └── teams/              # Team pages
├── components/             # React components
├── lib/
│   ├── auth/               # Authentication helpers
│   ├── db/                 # Database schema and connection
│   ├── prediction/         # ELO and prediction logic
│   ├── riders/             # Rider matching (find-or-create)
│   └── scraper/            # Data source scrapers
└── middleware.ts            # Auth middleware
```
