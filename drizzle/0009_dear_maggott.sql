CREATE TABLE "startlist_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_briefing_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"briefing_date" date NOT NULL,
	"briefing_type" varchar(20) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"content_key" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_briefing_unique" UNIQUE("user_id","briefing_date","briefing_type","channel")
);
--> statement-breakpoint
ALTER TABLE "startlist_events" ADD CONSTRAINT "startlist_events_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startlist_events" ADD CONSTRAINT "startlist_events_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_startlist_events_detected" ON "startlist_events" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "idx_startlist_events_rider" ON "startlist_events" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_briefing_date" ON "user_briefing_log" USING btree ("briefing_date");