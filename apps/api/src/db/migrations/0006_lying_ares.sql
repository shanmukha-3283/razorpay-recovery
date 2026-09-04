CREATE TABLE IF NOT EXISTS "dnd_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(20) NOT NULL,
	"owner_id" uuid,
	"reason" varchar(500),
	"owner" varchar(255) DEFAULT 'support-queue' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"sla_due" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "recovery_attempts" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dnd_entry_email_idx" ON "dnd_entries" USING btree ("email");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_attempts" ADD CONSTRAINT "recovery_attempts_batch_id_recovery_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recovery_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
