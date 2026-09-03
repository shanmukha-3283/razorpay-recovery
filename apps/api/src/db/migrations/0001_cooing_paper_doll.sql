CREATE TABLE IF NOT EXISTS "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"recovery_attempt_id" uuid,
	"channel" varchar(20) NOT NULL,
	"to_email" varchar(255),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"provider_message_id" varchar(255),
	"error" text,
	"message_body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_recovery_attempt_id_recovery_attempts_id_fk" FOREIGN KEY ("recovery_attempt_id") REFERENCES "public"."recovery_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
