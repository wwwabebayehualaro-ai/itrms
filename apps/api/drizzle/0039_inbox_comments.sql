ALTER TABLE "workflow"."case_tasks" ADD COLUMN "claimed_by" uuid;--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD COLUMN "claimed_at" timestamp with time zone;