CREATE TABLE IF NOT EXISTS "audit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_attempt_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"amount" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razorpay_customer_id" varchar(100) NOT NULL,
	"email" varchar(255),
	"contact" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razorpay_payment_id" varchar(100) NOT NULL,
	"subscription_id" uuid,
	"order_id" varchar(100),
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'INR',
	"status" varchar(50) NOT NULL,
	"method" varchar(50),
	"error_code" varchar(100),
	"error_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"razorpay_event_id" varchar(100),
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"action" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"amount" integer,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razorpay_subscription_id" varchar(100) NOT NULL,
	"customer_id" uuid,
	"plan_id" varchar(100),
	"status" varchar(50) NOT NULL,
	"current_start" timestamp,
	"current_end" timestamp,
	"paid_count" integer DEFAULT 0,
	"total_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_ledger" ADD CONSTRAINT "audit_ledger_recovery_attempt_id_recovery_attempts_id_fk" FOREIGN KEY ("recovery_attempt_id") REFERENCES "public"."recovery_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_attempts" ADD CONSTRAINT "recovery_attempts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_customer_id_idx" ON "customers" USING btree ("razorpay_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_payment_id_idx" ON "payments" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_event_id_idx" ON "raw_events" USING btree ("razorpay_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_subscription_id_idx" ON "subscriptions" USING btree ("razorpay_subscription_id");