# Race Communication Plan — Pro Cycling Predictor

## Philosophy

This is not a notification service. It's a **race companion**.

The user should feel like they have a knowledgeable cycling friend who messages them
before, during, and after every race they care about. Personal, opinionated, fan-to-fan
— not a press release.

Every message should pass this test: *"Would I send this to a friend who follows cycling?"*

---

## User Memory Files

Each user gets `memory/users/{userId}.md` in the workspace.

Tracks:
- Name (from Clerk)
- Preferred frequency: `all` | `key-moments` | `race-day-only`
- Followed riders + recent results
- Messages already sent (avoid repeating)
- Personal notes ("big MvdP fan", "follows cobbled classics")
- Last 10 interactions log

---

## Communication Arc — WorldTour Road Race

### T-7 days: "On the horizon"
Only for Monument-level or Grand Tour races. Short teaser, build anticipation.
> "Strade Bianche is one week away. The white roads of Tuscany. MvdP starts as favourite
> but Van Aert just posted a massive training block..."

- Image: none
- Send to: `all` frequency only

---

### T-2 days: "Race preview" ← THE MAIN MESSAGE
Rich, substantial. Attach the Instagram card as image.
- What makes this race special (one punchy paragraph)
- Top 5 predictions with short reasoning
- Weather if notable
- Followed riders + where we see them finishing
- Key rivalry or storyline to watch

Example:
> STRADE BIANCHE 2026
>
> 184km from Siena to Siena with 63km of white gravel. It destroys the peloton every
> year and produces the most chaotic finishes in cycling.
>
> Our model likes Van der Poel (18.3%) and Pidcock (12.1%) — both at their best on
> this terrain. Watch for Pogacar though, he won here in 2022 and 2024.
>
> You follow: Van der Poel (predicted 1st), Pidcock (predicted 2nd)
>
> procyclingpredictor.com/races/road/strade-bianche-2026/elite-men

- Image: prediction card (1080x1080)
- Send to: `all` + `key-moments`

---

### T-1 day: "Breaking news" (only if notable)
Triggered by: withdrawal, crash, weather change, rumour spike.
> "Bad news for Strade — Pidcock DNF'd Omloop with a knee issue and his team hasn't
> confirmed the start. Worth watching his social tonight."

- Image: none
- Send to: users who follow the affected rider
- Frequency: `all` + `key-moments`

---

### Race day morning: "It's race day"
Short. One insight. Race start time.
> "Race day. Strade Bianche starts 11:05 CET. Dry forecast — fast roads, which suits
> the punchers less than mud. MvdP has won every dry edition he's entered."

- Image: none
- Send to: `all` only

---

### T+1h after finish: "Result"
Write it like you watched it. Emotional payoff.
> VAN DER POEL WINS STRADE BIANCHE. Solo from 40km out — nobody could follow.
>
> Your riders: MvdP (1st — we had him #1), Pidcock (3rd — better than expected)
>
> procyclingpredictor.com/races/road/strade-bianche-2026/elite-men

- Image: results card (1080x1080)
- Send to: everyone (`all` + `key-moments` + `race-day-only`)

---

## Communication Arc — MTB/XCO Race

Shorter, faster, more chaotic. Everything compressed.

### T-1 day only:
- Course conditions > tactics (mud, heat, altitude)
- Top 3 only (XCO is chaotic)
- Holeshot matters — mention it

> WORLD CUP LENZERHEIDE — tomorrow
>
> High altitude, rocky technical upper section, rooty fast lower half.
> Favours Pidcock and Sarrou over pure power riders.
>
> Our picks: Pidcock (21%), Sarrou (14%), Schurter (11%)
>
> Watch the first lap — overtaking is almost impossible on the technical sections.

### Result (same day):
> PIDCOCK WINS LENZERHEIDE. Led every lap. Sarrou 2nd, Schurter had a puncture lap 3.
>
> Your riders: Pidcock (1st — nailed it)

---

## Frequency Settings (user chooses on /profile)

| Setting | Preview T-2 | Breaking news | Race day | Result |
|---------|------------|---------------|----------|--------|
| All updates | ✓ | ✓ | ✓ | ✓ |
| Key moments (default) | ✓ | ✓ | — | ✓ |
| Race day only | — | — | — | ✓ |

---

## Tone Guide

**Do:**
- Write in first person plural ("we like Van der Poel here")
- Use fan vocabulary (holeshot, rouleur, puncheur, GC battle)
- Have opinions — "this race suits X perfectly"
- Acknowledge uncertainty — "our model likes X but this is cycling"
- Short sentences on race day, richer in previews
- Reference what you've said before ("we had him top 3 — delivered")

**Don't:**
- "Hi [name]!" every single message
- Corporate language
- Repeat boilerplate
- Over-emoji
- Pad with filler

---

## Message Copy: AI-generated

`race-comms-agent.ts` uses Gemini to write the actual copy from:
1. Race data (name, date, country, UCI category)
2. Top predictions from DB
3. Recent news articles (race_news table)
4. User's followed riders + their predictions
5. User memory file (what we've already told them)
6. The relevant playbook (this file for road, MTB_COMMS.md for MTB)

The agent writes in the tone above, then the script sends it.

---

## Images

| Message | Image |
|---------|-------|
| Preview T-2 | Prediction card (1080x1080) |
| Race day | None |
| Breaking news | None |
| Result | Results card (1080x1080) |

Telegram: attach inline (native support)
WhatsApp: attach as image with caption text

---

## Implementation

### New DB table: `notification_log`
```sql
id, user_id, race_id, message_type (preview|breaking|raceday|result),
sent_at, channel (telegram|whatsapp)
```
Prevents duplicate sends.

### New column: `users.comms_frequency`
'all' | 'key-moments' | 'race-day-only' — default 'key-moments'

### New scripts:
- `race-comms-agent.ts` — AI copy generator
- Refactored `send-notifications.ts` — orchestrates the arc

### User memory:
- Read `memory/users/{userId}.md` before writing copy
- Update after sending (log what was said)
