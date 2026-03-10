// ── Time Windows ────────────────────────────────────────────────────────────

export type TimeWindow = "morning" | "midday" | "evening" | "late";

export function getTimeWindow(utcHour: number): TimeWindow | null {
  if (utcHour >= 7 && utcHour <= 9) return "morning";
  if (utcHour >= 10 && utcHour <= 15) return "midday";
  if (utcHour >= 17 && utcHour <= 20) return "evening";
  if (utcHour > 20 && utcHour <= 22) return "late";
  return null;
}

// ── Gathered Context (shared across all users) ─────────────────────────────

export interface GatheredRace {
  raceId: string;
  raceName: string;
  eventName: string;
  eventSlug: string | null;
  categorySlug: string | null;
  discipline: string;
  uciCategory: string | null;
  country: string | null;
  date: string;
  raceEventId: string;
  startTime: string | null;
  status: string;
  stageNumber: number | null;
  parentRaceId: string | null;
}

export interface GatheredPrediction {
  raceId: string;
  riderId: string;
  riderName: string;
  teamName: string | null;
  predictedPosition: number | null;
  winProbability: number;
}

export interface GatheredResult {
  raceId: string;
  riderId: string;
  riderName: string;
  teamName: string | null;
  position: number | null;
  dnf: boolean;
  dns: boolean;
}

export interface GatheredNewsArticle {
  id: string;
  raceEventId: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  publishedAt: Date | null;
}

export interface GatheredRumour {
  riderId: string;
  riderName: string;
  raceId: string | null;
  summary: string | null;
  sentiment: number;
  lastUpdated: Date;
}

export interface StartlistEvent {
  raceId: string;
  riderId: string;
  riderName: string;
  raceName: string;
  eventName: string;
  eventSlug: string | null;
  discipline: string;
  eventType: "added" | "removed";
  detectedAt: Date;
}

export interface DailyContext {
  todayRaces: GatheredRace[];
  tomorrowRaces: GatheredRace[];
  recentResults: GatheredRace[]; // completed races not yet notified
  startlistsByRace: Map<string, Set<string>>; // raceId -> Set<riderId>
  startlistTeamsByRace: Map<string, Map<string, string>>; // raceId -> Map<riderId, teamId>
  predictionsByRace: Map<string, GatheredPrediction[]>;
  resultsByRace: Map<string, GatheredResult[]>;
  newsArticles: GatheredNewsArticle[];
  rumours: GatheredRumour[];
  startlistEvents: StartlistEvent[];
  riderNames: Map<string, string>; // riderId -> name
  teamNames: Map<string, string>; // teamId -> name
}

// ── User Briefing Plan (per user) ──────────────────────────────────────────

export type ContentType =
  | "followed-rider-result"
  | "followed-rider-injury"
  | "followed-rider-racing-today"
  | "followed-rider-startlist-added"
  | "followed-rider-news"
  | "followed-rider-startlist-removed"
  | "followed-team-racing-today"
  | "followed-race-today"
  | "followed-rider-racing-tomorrow";

export interface BriefingItem {
  contentType: ContentType;
  score: number;
  raceId: string | null;
  riderId: string | null;
  teamId: string | null;
  data: Record<string, unknown>; // extra context for prompt building
}

export type BriefingType = "morning" | "midday-alert" | "evening";

export interface UserBriefingPlan {
  userId: string;
  briefingType: BriefingType;
  items: BriefingItem[];
  totalScore: number;
  // User's channels
  telegramChatId: string | null;
  whatsappPhone: string | null;
  whatsappFrequency: string | null;
}

// ── Delivery ───────────────────────────────────────────────────────────────

export interface UserChannels {
  userId: string;
  telegramChatId: string | null;
  whatsappPhone: string | null;
  whatsappFrequency: string | null;
  followedRiderIds: Set<string>;
  followedTeamIds: Set<string>;
  followedRaceEventIds: Set<string>;
}
