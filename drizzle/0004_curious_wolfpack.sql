CREATE TABLE "race_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_event_id" uuid NOT NULL,
	"race_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"url" text,
	"image_url" text,
	"source" varchar(50),
	"category" varchar(30) DEFAULT 'news',
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "race_news_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"follow_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_unique" UNIQUE("user_id","follow_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "user_telegram" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_chat_id" varchar(50),
	"connect_token" varchar(64),
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_telegram_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_telegram_connect_token_unique" UNIQUE("connect_token")
);
--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "wiki_slug" varchar(255);--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "pcs_url" varchar(500);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "slug" varchar(255);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "website" varchar(500);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "twitter" varchar(500);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "instagram" varchar(500);--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_telegram" ADD CONSTRAINT "user_telegram_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_race_news_event_id" ON "race_news" USING btree ("race_event_id");--> statement-breakpoint
CREATE INDEX "idx_race_news_published" ON "race_news" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_user_follows_user" ON "user_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_follows_entity" ON "user_follows" USING btree ("follow_type","entity_id");