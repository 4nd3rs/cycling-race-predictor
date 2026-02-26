# Brand Guidelines — Pro Cycling Predictor

> Version 1.0 · These guidelines apply to all generated graphics, the web app, and all social media presence.

---

## Philosophy

Pro cycling has one of the richest visual heritages in sport — cobblestones in Flemish rain, pelotons dissolving into Alpine fog, the narrow canyon of a mountain finish. The visual language of this sport is earned, not designed.

**We look like we belong in that world.**

Our references are race programs from Roubaix in the 1980s, Rouleur magazine, L'Equipe front pages, Graham Watson photographs. The vocabulary is: asphalt, newsprint, effort, precision.

What we are not: a dark-mode SaaS app. Not a sports betting site. Not an AI product. Not an e-sports platform.

The rule is simple: if it looks like it could belong on a tech startup landing page, do it differently.

---

## Color System

### Primary Palette

| Token | Hex | Usage |
|---|---|---|
| `--color-black` | `#0D0D0D` | Page backgrounds, primary surfaces. Near-black, not pure — feels print not screen. |
| `--color-warm-white` | `#F2EDE6` | Text on dark, light-mode backgrounds. Warm like newsprint. |
| `--color-red` | `#C8102E` | The one accent. UCI red. Flamme rouge. Used once per composition. |
| `--color-card` | `#161411` | Card surfaces. Slightly warm, not blue-black. |
| `--color-deep` | `#2C2823` | Alternative surface. Worn leather, wet asphalt. |

### Supporting Palette

| Token | Hex | Usage |
|---|---|---|
| `--color-gray-mid` | `#7A7065` | Secondary text, metadata, captions. Warm, not cool. |
| `--color-gray-light` | `#E8E0D5` | Dividers, subtle borders. |
| `--color-gray-dark` | `#3A3530` | Borders on dark backgrounds. |
| `--color-muted` | `#4A443E` | Tertiary text, URL in footer. |

### Rules

**Red is used once per composition.** Options: eyebrow label, position "1", a single accent line, the registered mark. Never as a background fill. Never twice.

**No blue. No purple. No teal.** These are the colors of tech startups and fintech dashboards. They do not belong here.

**No pure white or pure black.** `#FFFFFF` and `#000000` are too digital. Use `#F2EDE6` and `#0D0D0D`.

**No gradients as backgrounds.** A gradient on a photo overlay (dark vignette to let text read) is fine. A gradient background pretending to be space or atmosphere is not.

---

## Typography

### Typefaces

**Display: Barlow Condensed**
- Weight: ExtraBold (800) for headlines, Bold (700) for rider names
- Always uppercase for race names, section headers, position labels
- Letter-spacing: `-0.01em` to `0` (tight, not tracked out)
- This is the race-number font. It belongs in the sport.
- Load via Google Fonts: `Barlow+Condensed:wght@700;800`

**Body & UI: Inter**
- Weights: Regular (400) for reading text, SemiBold (600) for labels and metadata
- Tabular figures: `font-variant-numeric: tabular-nums` for all numbers, times, ELO
- Load via Google Fonts: `Inter:wght@400;500;600`

### Type Scale (1080×1080 social card)

| Element | Size | Font | Color |
|---|---|---|---|
| Race name | 76–88px | Barlow Condensed 800 | `#F2EDE6` |
| Eyebrow label | 11px | Inter 600, tracked 0.12em, uppercase | `#C8102E` |
| Position number (1st) | 52px | Barlow Condensed 800 | `#C8102E` |
| Position number (2nd–3rd) | 52px | Barlow Condensed 800 | `#7A7065` |
| Rider name | 27px | Barlow Condensed 700 | `#F2EDE6` |
| Team name | 13px | Inter 400 | `#7A7065` |
| Metadata (date, category) | 15px | Inter 600 | `#7A7065` |
| Intel / body text | 16px | Inter 400 | `#C8B9AD` |
| Footer URL | 13px | Inter 500 | `#4A443E` |
| Footer brand | 13px | Inter 600 uppercase tracked | `#7A7065` |

### Race Name Rules

- Always ALL CAPS
- Word-wrap on natural breaks
- Use em-dash, not hyphen: `PARIS–ROUBAIX` not `PARIS-ROUBAIX`
- If name exceeds ~20 characters, drop size to 60–68px
- If name is short (≤12 chars), push to 96px

---

## Iconography

**There are no icons in this system.**

This is a deliberate choice. Icons are the visual shorthand of apps and dashboards. We use type instead.

| Instead of | Use |
|---|---|
| 🏆 trophy | Text label `RACE RESULT` in red small caps |
| 🔮 crystal ball | Text label `PREDICTIONS` |
| 🥇🥈🥉 medals | Position numbers `1`, `2`, `3` set in type |
| ✅ checkmark emoji | Text `PREDICTED` or `CALLED IT` in tracked caps |
| 🕵️ detective | Text `INTEL` |
| Any flag emoji | 3-letter country code (BEL, NED, FRA) or a small raster flag image |

If a visual symbol is needed: use a typographic mark. A `·` bullet, an `—` em-dash, a `×` multiplier. These have weight without decoration.

---

## Photography

Photography is the brand's soul when we have it. It should always lead.

### Visual Tone

The sport earns its images. We want:
- **Effort**: sweat, grimace, the body under load
- **Texture**: wet cobbles, dusty gravel, cracked asphalt, mountain mist
- **Scale**: the peloton against a landscape, a rider dwarfed by an Alpe
- **Decisive moments**: the sprint, the breakaway, the crash, the finish-line face

We do not want:
- Stock images of happy riders on sunny paths
- Posed product shots
- Oversaturated Instagram-filter color
- AI-generated cyclist imagery

### Color Treatment

Apply one of these treatments consistently:

**Option A — Monochrome**: Desaturate fully to black and white. Strong contrast. Used for rider portraits.

**Option B — Muted Film**: Reduce saturation to 20–40%. Lift blacks slightly (not pure black). Feels like film photography, not digital.

**Option C — Dark overlay**: Keep photo color but apply `linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.92) 100%)`. Text sits on the dark lower third.

Never: oversaturated, HDR, or neon-toned images.

### In Graphics (generated cards)

When a photo is available:
- Full-bleed as background (1080×1080)
- Apply dark overlay (Option C above)
- All text overlaid on the bottom 60% of the image

When no photo is available:
- Flat `#161411` background
- Optional: a very subtle CSS noise texture (`opacity: 0.03`)
- Typography carries all weight — increase sizes slightly to compensate

### Image Sources (legal)

- **Wikimedia Commons** — CC-licensed rider and race photography. Check license per image.
- **Unsplash** (unsplash.com/s/photos/cycling) — Free, no attribution required for cards
- **Official team press kits** — check license; usually free for editorial use
- **Do not use**: Getty Images, AFP, Reuters, PA scrapes from news articles

---

## Card Design System

### Layout Grid

All generated graphics: **1080×1080px** (Instagram square) or **1080×1350px** (portrait, optional).

- Outer padding: **56px** all sides
- Column gutter: **24px**
- Baseline grid: **8px**
- Never center-align text — all text is left-aligned

### Structure

```
┌─────────────────────────────────────────────┐
│  [photo bg, optional]                       │
│                                             │
│  RACE PREVIEW              ← red, 11px, top │
│                             ← 16px gap      │
│  PARIS–ROUBAIX             ← 80px Barlow EB │
│  Sunday · Apr 13           ← 15px Inter     │
│  France · UCI WorldTour    ← 15px Inter     │
│                                             │
│  ───────────────────────   ← 1px #3A3530    │
│                                             │
│  PREDICTIONS               ← 11px label    │
│                             ← 20px gap      │
│  1   VAN DER POEL          ← 52px / 27px    │
│      Alpecin-Deceuninck    ← 13px gray      │
│                                             │
│  2   POGACAR                                │
│      UAE Team Emirates                      │
│                                             │
│  3   VAN AERT                               │
│      Visma–Lease a Bike                     │
│                                             │
│  ───────────────────────   ← 1px divider    │
│                                             │
│  procyclingpredictor.com   PRO CYCLING ·    │
└─────────────────────────────────────────────┘
```

### Position Numbers

- Large typographic element, not a badge or box
- `1` in `#C8102E` (red)
- `2` and `3` in `#7A7065` (gray)
- Vertically aligned with the middle of the rider name
- 52px Barlow Condensed 800
- Fixed width column: ~60px

### Dividers

A single 1px horizontal line in `#3A3530`. No decorative elements. No dots or dashes.

### Footer

Left: `procyclingpredictor.com` in 13px Inter 500, `#4A443E`
Right: `PRO CYCLING PREDICTOR` in 13px Inter 600, uppercase, tracked, `#7A7065`

These are the only two footer elements. No social icons. No QR codes. No "follow us" text.

### Card Types

**RACE PREVIEW** — posted 48h before race
- Eyebrow: `RACE PREVIEW` (red)
- Race name (large)
- Date, country, UCI category as text — comma or `·` separated, no pill badges
- Divider
- Section: `PREDICTIONS`
- Top 3 riders with teams
- Optional: 1–2 sentence intel note, no quotation marks, no attribution
- Footer

**RACE RESULT** — posted within 2h of finish
- Eyebrow: `RACE RESULT` (red)
- Race name
- Date, country
- Divider
- Section: `FINAL PODIUM`
- Top 3 with time gaps for 2nd/3rd
- Single line: `We called it` or `We predicted [name]` — plain text, no emoji
- Footer

**RIDER SPOTLIGHT** — weekly, Wednesdays
- Eyebrow: `RIDER SPOTLIGHT` (red)
- Photo as background (monochrome treatment preferred)
- Rider name (large)
- Nationality, team, discipline
- 3 stats: ELO, wins current season, best result
- No bullets — use `·` separator inline

**RANKINGS** — monthly
- Eyebrow: `CURRENT RANKINGS`
- Title: `TOP 10 · [DISCIPLINE]`
- Numbered list, riders with ELO score right-aligned
- A thin bar visualization using CSS width (no chart libraries)

---

## Web Application

### Surfaces

- Page background: `#0D0D0D`
- Card background: `#161411`
- Elevated card: `#1E1B18`
- Border: `1px solid rgba(255,255,255,0.06)` or `1px solid #2C2823`

### Interactive States

- Hover lift: `background: rgba(255,255,255,0.03)`
- Focus ring: `2px solid #C8102E`
- Active: slight brightness increase via `filter: brightness(1.08)`

### Text

- Primary: `#F2EDE6`
- Secondary: `#7A7065`
- Tertiary/meta: `#4A443E`
- Links: `#F2EDE6`, underline on hover only
- No colored text except red accent, once per component

### Race/Prediction Lists

No colored tags or status badges on list rows. Differentiate via:
- Type weight (Bold for upcoming, Regular for past)
- Opacity (past races at 60%)
- A thin red left-border on the active/live race row — that's it

---

## What We Are Not

A checklist for every design decision:

- **Not a tech startup** — no blue gradients, no purple, no "AI" iconography
- **Not a betting site** — no green money colors, no odds-ticker aesthetics, no "LIVE" badges in red boxes
- **Not a fantasy sports app** — no trophies, no podium podest clip-art, no achievement badges
- **Not a content aggregator** — no clickbait thumbnails, no ALL CAPS WARNING designs, no "YOU WON'T BELIEVE" energy
- **Not emoji-dependent** — no emoji anywhere, ever. Type does the work.

---

## Brand Wordmark

`PRO CYCLING PREDICTOR`

- Barlow Condensed SemiBold (700), all uppercase
- Single color (warm white on dark; near-black on light)
- No colored words, no red spans, no highlighted "PREDICTOR"
- Spacing: normal — do not stretch or condense artificially

Short form for constrained spaces: `PCP`

Domain (always lowercase in body text): `procyclingpredictor.com`

---

*Updated: 2026-02-26*
