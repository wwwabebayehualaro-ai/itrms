CREATE SCHEMA "kernel";
--> statement-breakpoint
CREATE TABLE "kernel"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"unit_id" uuid,
	"region_id" uuid,
	"org_path" "ltree",
	"action" text NOT NULL,
	"table_name" text,
	"row_id" uuid,
	"event_type" text,
	"diff" jsonb,
	"request_id" text,
	"ip" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "kernel"."audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "kernel"."audit_log" USING btree ("at");