CREATE TABLE "ai_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"race_id" uuid,
	"rider_id" uuid,
	"messages" jsonb DEFAULT '[]'::jsonb,
	"token_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discussion_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"parent_post_id" uuid,
	"upvotes" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "discussion_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid,
	"rider_id" uuid,
	"title" varchar(300),
	"user_id" uuid NOT NULL,
	"pinned" boolean DEFAULT false,
	"locked" boolean DEFAULT false,
	"post_count" integer DEFAULT 0,
	"last_post_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elo_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"discipline" varchar(20) NOT NULL,
	"age_category" varchar(20) NOT NULL,
	"elo_before" numeric(10, 4),
	"elo_after" numeric(10, 4),
	"elo_change" numeric(8, 4),
	"race_position" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"predicted_position" integer,
	"win_probability" numeric(5, 4),
	"podium_probability" numeric(5, 4),
	"top10_probability" numeric(5, 4),
	"confidence_score" numeric(5, 4),
	"reasoning" text,
	"elo_score" numeric(10, 4),
	"form_score" numeric(5, 4),
	"profile_affinity_score" numeric(5, 4),
	"rumour_modifier" numeric(5, 4),
	"version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255),
	"date" date NOT NULL,
	"end_date" date,
	"discipline" varchar(20) NOT NULL,
	"sub_discipline" varchar(20),
	"country" char(3),
	"source_url" varchar(500),
	"source_type" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "race_events_discipline_slug_unique" UNIQUE("discipline","slug")
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"team_id" uuid,
	"position" integer,
	"time_seconds" integer,
	"time_gap_seconds" integer,
	"points_uci" integer,
	"points_pcs" integer,
	"dnf" boolean DEFAULT false,
	"dns" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "race_result_unique" UNIQUE("race_id","rider_id")
);
--> statement-breakpoint
CREATE TABLE "race_startlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"bib_number" integer,
	"team_id" uuid,
	"status" varchar(20) DEFAULT 'confirmed',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "race_rider_unique" UNIQUE("race_id","rider_id")
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"category_slug" varchar(50),
	"date" date NOT NULL,
	"end_date" date,
	"discipline" varchar(20) NOT NULL,
	"race_type" varchar(20),
	"profile_type" varchar(20),
	"age_category" varchar(20) DEFAULT 'elite',
	"gender" varchar(10) DEFAULT 'men',
	"distance_km" numeric(8, 2),
	"elevation_m" integer,
	"uci_category" varchar(50),
	"country" char(3),
	"parent_race_id" uuid,
	"stage_number" integer,
	"race_event_id" uuid,
	"startlist_url" varchar(500),
	"submitted_by" uuid,
	"status" varchar(20) DEFAULT 'active',
	"pcs_url" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider_discipline_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"discipline" varchar(20) NOT NULL,
	"age_category" varchar(20) NOT NULL,
	"team_id" uuid,
	"specialty" text[],
	"current_elo" numeric(10, 2) DEFAULT '1500',
	"elo_mean" numeric(10, 4) DEFAULT '1500',
	"elo_variance" numeric(10, 4) DEFAULT '350',
	"wins_total" integer DEFAULT 0,
	"podiums_total" integer DEFAULT 0,
	"races_total" integer DEFAULT 0,
	"uci_points" integer DEFAULT 0,
	"uci_rank" integer,
	"world_cup_points" integer DEFAULT 0,
	"world_cup_rank" integer,
	"profile_affinities" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rider_discipline_category_unique" UNIQUE("rider_id","discipline","age_category")
);
--> statement-breakpoint
CREATE TABLE "rider_rumours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"race_id" uuid,
	"aggregate_score" numeric(4, 3),
	"tip_count" integer DEFAULT 0,
	"summary" text,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pcs_id" varchar(255),
	"uci_id" varchar(255),
	"xco_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"nationality" char(3),
	"birth_date" date,
	"photo_url" varchar(500),
	"instagram_handle" varchar(100),
	"strava_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"uci_code" varchar(10),
	"division" varchar(50),
	"discipline" varchar(20),
	"country" char(3),
	"logo_url" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"race_id" uuid,
	"tip_text" text NOT NULL,
	"tip_type" varchar(30),
	"sentiment" numeric(4, 3),
	"weight" numeric(4, 3),
	"verified" boolean DEFAULT false,
	"processed" boolean DEFAULT false,
	"extracted_category" varchar(50),
	"extracted_confidence" numeric(4, 3),
	"ai_reasoning" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"avatar_url" varchar(500),
	"tier" varchar(20) DEFAULT 'free',
	"tip_accuracy_score" numeric(5, 4) DEFAULT '0.5',
	"tips_submitted" integer DEFAULT 0,
	"tips_verified" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_thread_id_discussion_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."discussion_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_startlist" ADD CONSTRAINT "race_startlist_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_startlist" ADD CONSTRAINT "race_startlist_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_startlist" ADD CONSTRAINT "race_startlist_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_discipline_stats" ADD CONSTRAINT "rider_discipline_stats_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_discipline_stats" ADD CONSTRAINT "rider_discipline_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_rumours" ADD CONSTRAINT "rider_rumours_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_rumours" ADD CONSTRAINT "rider_rumours_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tips" ADD CONSTRAINT "user_tips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tips" ADD CONSTRAINT "user_tips_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tips" ADD CONSTRAINT "user_tips_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_posts_thread" ON "discussion_posts" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_threads_race" ON "discussion_threads" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_threads_rider" ON "discussion_threads" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_elo_history_rider" ON "elo_history" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_elo_history_race" ON "elo_history" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_predictions_race" ON "predictions" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_predictions_rider" ON "predictions" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_race_events_date" ON "race_events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_race_events_discipline" ON "race_events" USING btree ("discipline");--> statement-breakpoint
CREATE INDEX "idx_results_rider" ON "race_results" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_results_race" ON "race_results" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_startlist_race" ON "race_startlist" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_startlist_rider" ON "race_startlist" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_races_date" ON "races" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_races_discipline" ON "races" USING btree ("discipline");--> statement-breakpoint
CREATE INDEX "idx_races_status" ON "races" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_races_race_event" ON "races" USING btree ("race_event_id");--> statement-breakpoint
CREATE INDEX "idx_races_category_slug" ON "races" USING btree ("category_slug");--> statement-breakpoint
CREATE INDEX "idx_rider_stats_rider" ON "rider_discipline_stats" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_rider_stats_discipline" ON "rider_discipline_stats" USING btree ("discipline");--> statement-breakpoint
CREATE INDEX "idx_rumours_rider" ON "rider_rumours" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_rumours_race" ON "rider_rumours" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "idx_tips_unprocessed" ON "user_tips" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "idx_tips_rider" ON "user_tips" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_tips_user" ON "user_tips" USING btree ("user_id");