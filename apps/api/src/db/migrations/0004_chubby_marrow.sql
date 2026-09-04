CREATE TABLE IF NOT EXISTS "abandoned_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razorpay_order_id" varchar(100) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'INR',
	"email" varchar(255),
	"contact" varchar(50),
	"short_url" varchar(500),
	"status" varchar(50) DEFAULT 'abandoned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_deliveries" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_attempts" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD COLUMN "domain" varchar(20) DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "recovery_attempts" ADD COLUMN "domain" varchar(20) DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_attempts" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_checkout_order_id_idx" ON "abandoned_checkouts" USING btree ("razorpay_order_id");--> statement-breakpoint
UPDATE "recovery_attempts" SET "domain_id" = "subscription_id" WHERE "domain" = 'subscription' AND "domain_id" IS NULL;--> statement-breakpoint
UPDATE "message_deliveries" SET "domain_id" = "subscription_id" WHERE "domain" = 'subscription' AND "domain_id" IS NULL;