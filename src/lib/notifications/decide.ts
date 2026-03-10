import type {
  TimeWindow,
  DailyContext,
  UserChannels,
  UserBriefingPlan,
  BriefingItem,
  BriefingType,
} from "./types";

// ── Priority scoring ────────────────────────────────────────────────────────

const SCORE_FOLLOWED_RIDER_RESULT = 100;
const SCORE_FOLLOWED_RIDER_INJURY = 95;
const SCORE_FOLLOWED_RIDER_RACING_TODAY = 90;
const SCORE_FOLLOWED_RIDER_STARTLIST_ADDED = 85;
const SCORE_FOLLOWED_RIDER_NEWS = 80;
const SCORE_FOLLOWED_RIDER_STARTLIST_REMOVED = 75;
const SCORE_FOLLOWED_TEAM_RACING_TODAY = 50;
const SCORE_FOLLOWED_RACE_TODAY = 30;
const SCORE_FOLLOWED_RIDER_RACING_TOMORROW = 20;

const MIN_SCORE_THRESHOLD = 30;

// ── Frequency gates ─────────────────────────────────────────────────────────

function passesFrequencyGate(
  briefingType: BriefingType,
  waFrequency: string | null
): boolean {
  if (!waFrequency || waFrequency === "off") return false;
  switch (briefingType) {
    case "morning":
      return waFrequency === "all" || waFrequency === "key-moments";
    case "midday-alert":
      return waFrequency === "all" || waFrequency === "key-moments";
    case "evening":
      return waFrequency === "all" || waFrequency === "key-moments" || waFrequency === "race-day-only";
    default:
      return false;
  }
}

// ── Time window → briefing type ─────────────────────────────────────────────

function briefingTypeForWindow(window: TimeWindow): BriefingType {
  switch (window) {
    case "morning": return "morning";
    case "midday": return "midday-alert";
    case "evening": return "evening";
    case "late": return "evening"; // late uses evening type with stricter filtering
  }
}

// ── Main decide function ────────────────────────────────────────────────────

export function decide(
  ctx: DailyContext,
  user: UserChannels,
  window: TimeWindow,
): UserBriefingPlan | null {
  const briefingType = briefingTypeForWindow(window);
  const items: BriefingItem[] = [];

  // Check if user has a delivery channel
  const hasWa = user.whatsappPhone && passesFrequencyGate(briefingType, user.whatsappFrequency);
  if (!hasWa) return null;

  // ── Morning briefing ────────────────────────────────────────────────────

  if (window === "morning") {
    // Today's races: followed riders on startlist
    for (const race of ctx.todayRaces) {
      const startlist = ctx.startlistsByRace.get(race.raceId);
      if (!startlist) continue;

      // Followed riders racing today
      for (const riderId of user.followedRiderIds) {
        if (startlist.has(riderId)) {
          const preds = ctx.predictionsByRace.get(race.raceId) || [];
          const pred = preds.find(p => p.riderId === riderId);
          items.push({
            contentType: "followed-rider-racing-today",
            score: SCORE_FOLLOWED_RIDER_RACING_TODAY,
            raceId: race.raceId,
            riderId,
            teamId: null,
            data: {
              raceName: race.raceName,
              eventName: race.eventName,
              predictedPosition: pred?.predictedPosition ?? null,
              winProbability: pred?.winProbability ?? 0,
            },
          });
        }
      }

      // Followed teams racing today
      const teamRiderMap = ctx.startlistTeamsByRace.get(race.raceId);
      if (teamRiderMap) {
        const teamsInRace = new Set(teamRiderMap.values());
        for (const teamId of user.followedTeamIds) {
          if (teamsInRace.has(teamId)) {
            const riderCount = [...teamRiderMap.entries()]
              .filter(([, tid]) => tid === teamId).length;
            items.push({
              contentType: "followed-team-racing-today",
              score: SCORE_FOLLOWED_TEAM_RACING_TODAY,
              raceId: race.raceId,
              riderId: null,
              teamId,
              data: {
                raceName: race.raceName,
                eventName: race.eventName,
                riderCount,
              },
            });
          }
        }
      }

      // Followed race event today (no personal riders)
      if (user.followedRaceEventIds.has(race.raceEventId)) {
        const hasPersonalContent = items.some(
          i => i.raceId === race.raceId && i.contentType !== "followed-race-today"
        );
        if (!hasPersonalContent) {
          items.push({
            contentType: "followed-race-today",
            score: SCORE_FOLLOWED_RACE_TODAY,
            raceId: race.raceId,
            riderId: null,
            teamId: null,
            data: { raceName: race.raceName, eventName: race.eventName },
          });
        }
      }
    }

    // Tomorrow preview (brief mentions)
    for (const race of ctx.tomorrowRaces) {
      const startlist = ctx.startlistsByRace.get(race.raceId);
      if (!startlist) continue;

      for (const riderId of user.followedRiderIds) {
        if (startlist.has(riderId)) {
          items.push({
            contentType: "followed-rider-racing-tomorrow",
            score: SCORE_FOLLOWED_RIDER_RACING_TOMORROW,
            raceId: race.raceId,
            riderId,
            teamId: null,
            data: { raceName: race.raceName, eventName: race.eventName },
          });
        }
      }
    }

    // Startlist additions (riders added to upcoming races)
    for (const se of ctx.startlistEvents) {
      if (se.eventType !== "added") continue;
      if (user.followedRiderIds.has(se.riderId)) {
        items.push({
          contentType: "followed-rider-startlist-added",
          score: SCORE_FOLLOWED_RIDER_STARTLIST_ADDED,
          raceId: se.raceId,
          riderId: se.riderId,
          teamId: null,
          data: {
            raceName: se.raceName,
            eventName: se.eventName,
            eventSlug: se.eventSlug,
            discipline: se.discipline,
          },
        });
      }
    }
  }

  // ── Midday alerts ─────────────────────────────────────────────────────────

  if (window === "midday") {
    // Injury/withdrawal rumours
    for (const rumour of ctx.rumours) {
      if (rumour.sentiment >= -0.5) continue; // Only strong negative
      if (!user.followedRiderIds.has(rumour.riderId)) continue;
      // Check if this looks like injury content
      const summaryLower = (rumour.summary || "").toLowerCase();
      const isInjury = ["injur", "crash", "sick", "withdraw", "abandon", "surgery", "dns", "dnf", "fracture", "broke"]
        .some(kw => summaryLower.includes(kw));
      if (!isInjury) continue;

      items.push({
        contentType: "followed-rider-injury",
        score: SCORE_FOLLOWED_RIDER_INJURY,
        raceId: rumour.raceId,
        riderId: rumour.riderId,
        teamId: null,
        data: { summary: rumour.summary, sentiment: rumour.sentiment },
      });
    }

    // Startlist removals (DNS)
    for (const se of ctx.startlistEvents) {
      if (se.eventType !== "removed") continue;
      if (user.followedRiderIds.has(se.riderId)) {
        items.push({
          contentType: "followed-rider-startlist-removed",
          score: SCORE_FOLLOWED_RIDER_STARTLIST_REMOVED,
          raceId: se.raceId,
          riderId: se.riderId,
          teamId: null,
          data: {
            raceName: se.raceName,
            eventName: se.eventName,
          },
        });
      }
    }

    // Startlist additions (urgent — rider just signed up)
    for (const se of ctx.startlistEvents) {
      if (se.eventType !== "added") continue;
      if (user.followedRiderIds.has(se.riderId)) {
        items.push({
          contentType: "followed-rider-startlist-added",
          score: SCORE_FOLLOWED_RIDER_STARTLIST_ADDED,
          raceId: se.raceId,
          riderId: se.riderId,
          teamId: null,
          data: {
            raceName: se.raceName,
            eventName: se.eventName,
            eventSlug: se.eventSlug,
            discipline: se.discipline,
          },
        });
      }
    }
  }

  // ── Evening digest ────────────────────────────────────────────────────────

  if (window === "evening" || window === "late") {
    // Results for followed riders
    for (const race of ctx.recentResults) {
      const results = ctx.resultsByRace.get(race.raceId) || [];
      if (results.length < 3) continue; // Skip races with too few results

      for (const riderId of user.followedRiderIds) {
        const result = results.find(r => r.riderId === riderId);
        if (!result) continue;

        const preds = ctx.predictionsByRace.get(race.raceId) || [];
        const pred = preds.find(p => p.riderId === riderId);

        items.push({
          contentType: "followed-rider-result",
          score: SCORE_FOLLOWED_RIDER_RESULT,
          raceId: race.raceId,
          riderId,
          teamId: null,
          data: {
            raceName: race.raceName,
            eventName: race.eventName,
            actualPosition: result.position,
            predictedPosition: pred?.predictedPosition ?? null,
            dnf: result.dnf,
            dns: result.dns,
            topResults: results.slice(0, 5).map(r => ({
              position: r.position,
              riderName: r.riderName,
              teamName: r.teamName,
            })),
          },
        });
      }

      // Also include if user follows the race event
      if (user.followedRaceEventIds.has(race.raceEventId)) {
        const hasRiderResult = items.some(
          i => i.raceId === race.raceId && i.contentType === "followed-rider-result"
        );
        if (!hasRiderResult) {
          items.push({
            contentType: "followed-race-today",
            score: SCORE_FOLLOWED_RACE_TODAY,
            raceId: race.raceId,
            riderId: null,
            teamId: null,
            data: {
              raceName: race.raceName,
              eventName: race.eventName,
              topResults: results.slice(0, 5).map(r => ({
                position: r.position,
                riderName: r.riderName,
                teamName: r.teamName,
              })),
            },
          });
        }
      }
    }

    // News with article URLs for followed riders
    // Match news to followed race events
    const followedEventIds = user.followedRaceEventIds;
    for (const article of ctx.newsArticles) {
      if (!article.url) continue;
      if (followedEventIds.has(article.raceEventId)) {
        items.push({
          contentType: "followed-rider-news",
          score: SCORE_FOLLOWED_RIDER_NEWS,
          raceId: null,
          riderId: null,
          teamId: null,
          data: {
            title: article.title,
            summary: article.summary,
            url: article.url,
            source: article.source,
          },
        });
      }
    }

    // Rider rumour news (non-injury, for evening roundup)
    for (const rumour of ctx.rumours) {
      if (!user.followedRiderIds.has(rumour.riderId)) continue;
      // Skip injury rumours (already handled in midday)
      const summaryLower = (rumour.summary || "").toLowerCase();
      const isInjury = ["injur", "crash", "sick", "withdraw", "abandon", "surgery"].some(kw => summaryLower.includes(kw));
      if (isInjury) continue;

      items.push({
        contentType: "followed-rider-news",
        score: SCORE_FOLLOWED_RIDER_NEWS - 10, // Slightly lower than article news
        raceId: rumour.raceId,
        riderId: rumour.riderId,
        teamId: null,
        data: { summary: rumour.summary, sentiment: rumour.sentiment },
      });
    }
  }

  // ── Late window: only urgent content ──────────────────────────────────────

  if (window === "late") {
    // Filter to only high-priority items
    const urgentItems = items.filter(i => i.score >= 75);
    if (urgentItems.length === 0) return null;
    items.length = 0;
    items.push(...urgentItems);
  }

  // ── Deduplicate items (same rider+race combination) ───────────────────────

  const seen = new Set<string>();
  const deduped = items.filter(item => {
    const key = `${item.contentType}-${item.raceId}-${item.riderId}-${item.teamId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Score threshold ───────────────────────────────────────────────────────

  const totalScore = deduped.reduce((sum, i) => sum + i.score, 0);
  if (totalScore < MIN_SCORE_THRESHOLD) return null;

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score);

  return {
    userId: user.userId,
    briefingType,
    items: deduped,
    totalScore,
    whatsappPhone: hasWa ? user.whatsappPhone : null,
    whatsappFrequency: user.whatsappFrequency,
  };
}
