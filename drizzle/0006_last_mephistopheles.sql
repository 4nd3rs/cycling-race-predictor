CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"channel" varchar(20) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" varchar(40) NOT NULL,
	"phone_number" varchar(20),
	"display_name" varchar(100),
	"is_admin" boolean DEFAULT false NOT NULL,
	"invite_sent_at" timestamp,
	"joined_at" timestamp,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"first_warned_at" timestamp,
	"last_warned_at" timestamp,
	"kicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_group_members_jid_unique" UNIQUE("jid")
);
--> statement-breakpoint
ALTER TABLE "race_news" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "race_news" ADD COLUMN "content_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_frequency" varchar(20) DEFAULT 'daily';