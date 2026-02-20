import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  integer,
  boolean,
  jsonb,
  char,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// CORE ENTITIES
// ============================================================================

export const riders = pgTable("riders", {
  id: uuid("id").primaryKey().defaultRandom(),
  pcsId: varchar("pcs_id", { length: 255 }), // ProCyclingStats ID
  uciId: varchar("uci_id", { length: 255 }), // UCI ID
  xcoId: varchar("xco_id", { length: 255 }), // XCODATA ID (for MTB)
  name: varchar("name", { length: 255 }).notNull(),
  nationality: char("nationality", { length: 3 }),
  birthDate: date("birth_date"),
  teamId: uuid("team_id").references(() => teams.id), // Current team
  photoUrl: varchar("photo_url", { length: 500 }),
  instagramHandle: varchar("instagram_handle", { length: 100 }),
  stravaId: varchar("strava_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  uciCode: varchar("uci_code", { length: 10 }),
  division: varchar("division", { length: 50 }), // WorldTour, ProTeam, etc.
  discipline: varchar("discipline", { length: 20 }), // 'road' | 'mtb'
  country: char("country", { length: 3 }),
  logoUrl: varchar("logo_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Separate stats per discipline AND age category
export const riderDisciplineStats = pgTable(
  "rider_discipline_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    discipline: varchar("discipline", { length: 20 }).notNull(), // 'road' | 'mtb'
    ageCategory: varchar("age_category", { length: 20 }).notNull(), // 'elite' | 'u23' | 'junior' | 'masters'
    gender: varchar("gender", { length: 10 }).default("men"), // 'men' | 'women'
    teamId: uuid("team_id").references(() => teams.id),
    specialty: text("specialty").array(), // ['climber', 'sprinter', 'gc', 'tt'] or ['technical', 'power']
    currentElo: decimal("current_elo", { precision: 10, scale: 2 }).default("1500"),
    eloMean: decimal("elo_mean", { precision: 10, scale: 4 }).default("1500"),
    eloVariance: decimal("elo_variance", { precision: 10, scale: 4 }).default("350"),
    winsTotal: integer("wins_total").default(0),
    podiumsTotal: integer("podiums_total").default(0),
    racesTotal: integer("races_total").default(0),
    // UCI ranking data (primarily for MTB)
    uciPoints: integer("uci_points").default(0),
    uciRank: integer("uci_rank"),
    // World Cup points (separate from UCI ranking points)
    worldCupPoints: integer("world_cup_points").default(0),
    worldCupRank: integer("world_cup_rank"),
    // SuperCup MTB points
    supercupPoints: integer("supercup_points").default(0),
    supercupRank: integer("supercup_rank"),
    // Profile affinities as JSON: {"flat": 0.6, "hilly": 0.8, "mountain": 0.9}
    profileAffinities: jsonb("profile_affinities").$type<Record<string, number>>(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("rider_discipline_category_unique").on(
      table.riderId,
      table.discipline,
      table.ageCategory
    ),
    index("idx_rider_stats_rider").on(table.riderId),
    index("idx_rider_stats_discipline").on(table.discipline),
  ]
);

// ============================================================================
// RACES
// ============================================================================

// Multi-category events (e.g., MTB events with separate Elite/U23/Junior races)
export const raceEvents = pgTable(
  "race_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }), // URL-friendly slug (e.g., "shimano-supercup-2026")
    date: date("date").notNull(),
    endDate: date("end_date"), // For multi-day events
    discipline: varchar("discipline", { length: 20 }).notNull(), // 'mtb' | 'road' | 'gravel' | 'cyclocross'
    subDiscipline: varchar("sub_discipline", { length: 20 }), // 'xco' | 'xcc' | 'xce' | 'xcm' for MTB
    country: char("country", { length: 3 }),
    sourceUrl: varchar("source_url", { length: 500 }),
    sourceType: varchar("source_type", { length: 50 }), // "rockthesport", "pcs", etc.
    series: varchar("series", { length: 50 }), // "supercup", "copa_catalana", etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_race_events_date").on(table.date),
    index("idx_race_events_discipline").on(table.discipline),
    unique("race_events_discipline_slug_unique").on(table.discipline, table.slug),
  ]
);

export const races = pgTable(
  "races",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    categorySlug: varchar("category_slug", { length: 50 }), // URL-friendly category slug (e.g., "elite-men", "u23-women")
    date: date("date").notNull(),
    endDate: date("end_date"), // For multi-day events
    discipline: varchar("discipline", { length: 20 }).notNull(), // 'mtb' | 'road' | 'gravel' | 'cyclocross'
    raceType: varchar("race_type", { length: 20 }), // 'one_day' | 'stage_race' | 'xco' | 'xcc'
    profileType: varchar("profile_type", { length: 20 }), // 'flat' | 'hilly' | 'mountain' | 'tt' | 'cobbles'
    ageCategory: varchar("age_category", { length: 20 }).default("elite"), // 'elite' | 'u23' | 'junior' | 'masters'
    gender: varchar("gender", { length: 10 }).default("men"), // 'men' | 'women'
    distanceKm: decimal("distance_km", { precision: 8, scale: 2 }),
    elevationM: integer("elevation_m"),
    uciCategory: varchar("uci_category", { length: 50 }), // e.g., 'WorldTour', '2.Pro', '1.1'
    country: char("country", { length: 3 }),
    parentRaceId: uuid("parent_race_id"), // For stages within stage races
    stageNumber: integer("stage_number"),
    raceEventId: uuid("race_event_id").references(() => raceEvents.id), // Link to multi-category event
    // Submission tracking
    startlistUrl: varchar("startlist_url", { length: 500 }), // Official source URL
    submittedBy: uuid("submitted_by").references(() => users.id),
    status: varchar("status", { length: 20 }).default("active"), // 'pending' | 'active' | 'completed'
    pcsUrl: varchar("pcs_url", { length: 500 }), // ProCyclingStats URL
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_races_date").on(table.date),
    index("idx_races_discipline").on(table.discipline),
    index("idx_races_status").on(table.status),
    index("idx_races_race_event").on(table.raceEventId),
    index("idx_races_category_slug").on(table.categorySlug),
  ]
);

// Race startlist (links races to riders)
export const raceStartlist = pgTable(
  "race_startlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .references(() => races.id, { onDelete: "cascade" })
      .notNull(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    bibNumber: integer("bib_number"),
    teamId: uuid("team_id").references(() => teams.id),
    status: varchar("status", { length: 20 }).default("confirmed"), // 'confirmed' | 'dns' | 'dnf'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_startlist_race").on(table.raceId),
    index("idx_startlist_rider").on(table.riderId),
    unique("race_rider_unique").on(table.raceId, table.riderId),
  ]
);

export const raceResults = pgTable(
  "race_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .references(() => races.id, { onDelete: "cascade" })
      .notNull(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id").references(() => teams.id),
    position: integer("position"),
    timeSeconds: integer("time_seconds"),
    timeGapSeconds: integer("time_gap_seconds"),
    pointsUci: integer("points_uci"),
    pointsPcs: integer("points_pcs"),
    dnf: boolean("dnf").default(false),
    dns: boolean("dns").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_results_rider").on(table.riderId),
    index("idx_results_race").on(table.raceId),
    unique("race_result_unique").on(table.raceId, table.riderId),
  ]
);

// ============================================================================
// PREDICTIONS
// ============================================================================

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .references(() => races.id, { onDelete: "cascade" })
      .notNull(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    predictedPosition: integer("predicted_position"),
    winProbability: decimal("win_probability", { precision: 5, scale: 4 }),
    podiumProbability: decimal("podium_probability", { precision: 5, scale: 4 }),
    top10Probability: decimal("top10_probability", { precision: 5, scale: 4 }),
    confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),
    reasoning: text("reasoning"), // AI-generated explanation
    // Breakdown of score components
    eloScore: decimal("elo_score", { precision: 10, scale: 4 }),
    formScore: decimal("form_score", { precision: 5, scale: 4 }),
    profileAffinityScore: decimal("profile_affinity_score", { precision: 5, scale: 4 }),
    rumourModifier: decimal("rumour_modifier", { precision: 5, scale: 4 }),
    version: integer("version").default(1), // Track prediction iterations
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_predictions_race").on(table.raceId),
    index("idx_predictions_rider").on(table.riderId),
  ]
);

// ============================================================================
// USERS & AUTHENTICATION
// ============================================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: varchar("clerk_id", { length: 255 }).unique().notNull(),
  email: varchar("email", { length: 255 }).unique(),
  name: varchar("name", { length: 255 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  tier: varchar("tier", { length: 20 }).default("free"), // 'free' | 'premium'
  tipAccuracyScore: decimal("tip_accuracy_score", { precision: 5, scale: 4 }).default("0.5"),
  tipsSubmitted: integer("tips_submitted").default(0),
  tipsVerified: integer("tips_verified").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// TIPS & RUMOURS
// ============================================================================

export const userTips = pgTable(
  "user_tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    raceId: uuid("race_id").references(() => races.id, { onDelete: "set null" }),
    tipText: text("tip_text").notNull(),
    tipType: varchar("tip_type", { length: 30 }), // 'injury' | 'form' | 'motivation' | 'team_dynamics' | 'other'
    sentiment: decimal("sentiment", { precision: 4, scale: 3 }), // -1 to 1 (AI-analyzed)
    weight: decimal("weight", { precision: 4, scale: 3 }), // Reliability weight
    verified: boolean("verified").default(false),
    processed: boolean("processed").default(false),
    // AI parsing results
    extractedCategory: varchar("extracted_category", { length: 50 }),
    extractedConfidence: decimal("extracted_confidence", { precision: 4, scale: 3 }),
    aiReasoning: text("ai_reasoning"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_tips_unprocessed").on(table.processed),
    index("idx_tips_rider").on(table.riderId),
    index("idx_tips_user").on(table.userId),
  ]
);

// Rumour aggregates (calculated from user_tips)
export const riderRumours = pgTable(
  "rider_rumours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    raceId: uuid("race_id").references(() => races.id, { onDelete: "cascade" }), // Optional: race-specific
    aggregateScore: decimal("aggregate_score", { precision: 4, scale: 3 }), // -1.0 to +1.0
    tipCount: integer("tip_count").default(0),
    summary: text("summary"), // AI-generated summary of rumours
    lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  },
  (table) => [
    index("idx_rumours_rider").on(table.riderId),
    index("idx_rumours_race").on(table.raceId),
  ]
);

// ============================================================================
// DISCUSSIONS / FORUM
// ============================================================================

export const discussionThreads = pgTable(
  "discussion_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id").references(() => races.id, { onDelete: "cascade" }),
    riderId: uuid("rider_id").references(() => riders.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    pinned: boolean("pinned").default(false),
    locked: boolean("locked").default(false),
    postCount: integer("post_count").default(0),
    lastPostAt: timestamp("last_post_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_threads_race").on(table.raceId),
    index("idx_threads_rider").on(table.riderId),
  ]
);

export const discussionPosts = pgTable(
  "discussion_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .references(() => discussionThreads.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    parentPostId: uuid("parent_post_id"), // For nested replies
    upvotes: integer("upvotes").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    editedAt: timestamp("edited_at"),
  },
  (table) => [index("idx_posts_thread").on(table.threadId)]
);

// ============================================================================
// AI CHAT (PREMIUM)
// ============================================================================

export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  raceId: uuid("race_id").references(() => races.id, { onDelete: "set null" }),
  riderId: uuid("rider_id").references(() => riders.id, { onDelete: "set null" }),
  // Messages as JSON array: [{role: 'user'|'assistant', content: string, timestamp: string}]
  messages: jsonb("messages").$type<Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>>().default([]),
  tokenCount: integer("token_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// UCI SYNC TRACKING
// ============================================================================

export const uciSyncRuns = pgTable("uci_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  discipline: varchar("discipline", { length: 20 }).notNull(), // 'mtb' | 'road' | 'cyclocross'
  source: varchar("source", { length: 50 }).notNull(), // 'xcodata' | 'uci_dataride'
  status: varchar("status", { length: 20 }).notNull().default("running"), // 'running' | 'completed' | 'failed'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  totalEntries: integer("total_entries").default(0),
  ridersCreated: integer("riders_created").default(0),
  ridersUpdated: integer("riders_updated").default(0),
  teamsCreated: integer("teams_created").default(0),
  errors: jsonb("errors").$type<string[]>().default([]),
  categoryDetails: jsonb("category_details").$type<Array<{
    category: string;
    entries: number;
    ridersCreated: number;
    ridersUpdated: number;
  }>>().default([]),
});

// ============================================================================
// ELO HISTORY (for tracking rating changes)
// ============================================================================

export const eloHistory = pgTable(
  "elo_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riderId: uuid("rider_id")
      .references(() => riders.id, { onDelete: "cascade" })
      .notNull(),
    raceId: uuid("race_id")
      .references(() => races.id, { onDelete: "cascade" })
      .notNull(),
    discipline: varchar("discipline", { length: 20 }).notNull(),
    ageCategory: varchar("age_category", { length: 20 }).notNull(),
    eloBefore: decimal("elo_before", { precision: 10, scale: 4 }),
    eloAfter: decimal("elo_after", { precision: 10, scale: 4 }),
    eloChange: decimal("elo_change", { precision: 8, scale: 4 }),
    racePosition: integer("race_position"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_elo_history_rider").on(table.riderId),
    index("idx_elo_history_race").on(table.raceId),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const ridersRelations = relations(riders, ({ many }) => ({
  disciplineStats: many(riderDisciplineStats),
  startlistEntries: many(raceStartlist),
  results: many(raceResults),
  predictions: many(predictions),
  tips: many(userTips),
  rumours: many(riderRumours),
  threads: many(discussionThreads),
  eloHistory: many(eloHistory),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  riderStats: many(riderDisciplineStats),
  startlistEntries: many(raceStartlist),
}));

export const riderDisciplineStatsRelations = relations(riderDisciplineStats, ({ one }) => ({
  rider: one(riders, {
    fields: [riderDisciplineStats.riderId],
    references: [riders.id],
  }),
  team: one(teams, {
    fields: [riderDisciplineStats.teamId],
    references: [teams.id],
  }),
}));

export const raceEventsRelations = relations(raceEvents, ({ many }) => ({
  races: many(races),
}));

export const racesRelations = relations(races, ({ one, many }) => ({
  parentRace: one(races, {
    fields: [races.parentRaceId],
    references: [races.id],
  }),
  raceEvent: one(raceEvents, {
    fields: [races.raceEventId],
    references: [raceEvents.id],
  }),
  submitter: one(users, {
    fields: [races.submittedBy],
    references: [users.id],
  }),
  startlist: many(raceStartlist),
  results: many(raceResults),
  predictions: many(predictions),
  threads: many(discussionThreads),
  rumours: many(riderRumours),
  chatSessions: many(aiChatSessions),
}));

export const raceStartlistRelations = relations(raceStartlist, ({ one }) => ({
  race: one(races, {
    fields: [raceStartlist.raceId],
    references: [races.id],
  }),
  rider: one(riders, {
    fields: [raceStartlist.riderId],
    references: [riders.id],
  }),
  team: one(teams, {
    fields: [raceStartlist.teamId],
    references: [teams.id],
  }),
}));

export const raceResultsRelations = relations(raceResults, ({ one }) => ({
  race: one(races, {
    fields: [raceResults.raceId],
    references: [races.id],
  }),
  rider: one(riders, {
    fields: [raceResults.riderId],
    references: [riders.id],
  }),
}));

export const predictionsRelations = relations(predictions, ({ one }) => ({
  race: one(races, {
    fields: [predictions.raceId],
    references: [races.id],
  }),
  rider: one(riders, {
    fields: [predictions.riderId],
    references: [riders.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  tips: many(userTips),
  threads: many(discussionThreads),
  posts: many(discussionPosts),
  chatSessions: many(aiChatSessions),
  submittedRaces: many(races),
}));

export const userTipsRelations = relations(userTips, ({ one }) => ({
  user: one(users, {
    fields: [userTips.userId],
    references: [users.id],
  }),
  rider: one(riders, {
    fields: [userTips.riderId],
    references: [riders.id],
  }),
  race: one(races, {
    fields: [userTips.raceId],
    references: [races.id],
  }),
}));

export const riderRumoursRelations = relations(riderRumours, ({ one }) => ({
  rider: one(riders, {
    fields: [riderRumours.riderId],
    references: [riders.id],
  }),
  race: one(races, {
    fields: [riderRumours.raceId],
    references: [races.id],
  }),
}));

export const discussionThreadsRelations = relations(discussionThreads, ({ one, many }) => ({
  race: one(races, {
    fields: [discussionThreads.raceId],
    references: [races.id],
  }),
  rider: one(riders, {
    fields: [discussionThreads.riderId],
    references: [riders.id],
  }),
  user: one(users, {
    fields: [discussionThreads.userId],
    references: [users.id],
  }),
  posts: many(discussionPosts),
}));

export const discussionPostsRelations = relations(discussionPosts, ({ one }) => ({
  thread: one(discussionThreads, {
    fields: [discussionPosts.threadId],
    references: [discussionThreads.id],
  }),
  user: one(users, {
    fields: [discussionPosts.userId],
    references: [users.id],
  }),
  parentPost: one(discussionPosts, {
    fields: [discussionPosts.parentPostId],
    references: [discussionPosts.id],
  }),
}));

export const aiChatSessionsRelations = relations(aiChatSessions, ({ one }) => ({
  user: one(users, {
    fields: [aiChatSessions.userId],
    references: [users.id],
  }),
  race: one(races, {
    fields: [aiChatSessions.raceId],
    references: [races.id],
  }),
  rider: one(riders, {
    fields: [aiChatSessions.riderId],
    references: [riders.id],
  }),
}));

export const eloHistoryRelations = relations(eloHistory, ({ one }) => ({
  rider: one(riders, {
    fields: [eloHistory.riderId],
    references: [riders.id],
  }),
  race: one(races, {
    fields: [eloHistory.raceId],
    references: [races.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Rider = typeof riders.$inferSelect;
export type NewRider = typeof riders.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type RiderDisciplineStats = typeof riderDisciplineStats.$inferSelect;
export type NewRiderDisciplineStats = typeof riderDisciplineStats.$inferInsert;
export type RaceEvent = typeof raceEvents.$inferSelect;
export type NewRaceEvent = typeof raceEvents.$inferInsert;
export type Race = typeof races.$inferSelect;
export type NewRace = typeof races.$inferInsert;
export type RaceStartlist = typeof raceStartlist.$inferSelect;
export type NewRaceStartlist = typeof raceStartlist.$inferInsert;
export type RaceResult = typeof raceResults.$inferSelect;
export type NewRaceResult = typeof raceResults.$inferInsert;
export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserTip = typeof userTips.$inferSelect;
export type NewUserTip = typeof userTips.$inferInsert;
export type RiderRumour = typeof riderRumours.$inferSelect;
export type NewRiderRumour = typeof riderRumours.$inferInsert;
export type DiscussionThread = typeof discussionThreads.$inferSelect;
export type NewDiscussionThread = typeof discussionThreads.$inferInsert;
export type DiscussionPost = typeof discussionPosts.$inferSelect;
export type NewDiscussionPost = typeof discussionPosts.$inferInsert;
export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type NewAiChatSession = typeof aiChatSessions.$inferInsert;
export type EloHistory = typeof eloHistory.$inferSelect;
export type NewEloHistory = typeof eloHistory.$inferInsert;
export type UciSyncRun = typeof uciSyncRuns.$inferSelect;
export type NewUciSyncRun = typeof uciSyncRuns.$inferInsert;
