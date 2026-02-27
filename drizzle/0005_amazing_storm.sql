CREATE TABLE "user_whatsapp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_number" varchar(20),
	"connect_token" varchar(64),
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_whatsapp_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_whatsapp_connect_token_unique" UNIQUE("connect_token")
);
--> statement-breakpoint
ALTER TABLE "user_whatsapp" ADD CONSTRAINT "user_whatsapp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;