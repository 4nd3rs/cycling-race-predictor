ALTER TABLE "race_events" ADD COLUMN "series" varchar(50);--> statement-breakpoint
ALTER TABLE "rider_discipline_stats" ADD COLUMN "supercup_points" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "rider_discipline_stats" ADD COLUMN "supercup_rank" integer;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;