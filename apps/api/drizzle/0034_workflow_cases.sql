CREATE TABLE "workflow"."case_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"action" text,
	"actor_user_id" uuid,
	"system_actor" text,
	"comment" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "workflow"."case_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"state_key" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"routed_from_unit_id" uuid,
	"acted_by" uuid,
	"action" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"number" bigint NOT NULL,
	"definition_version_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"state" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" uuid NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflow"."case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."case_events" ADD CONSTRAINT "case_events_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD CONSTRAINT "case_tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD CONSTRAINT "case_tasks_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD CONSTRAINT "case_tasks_routed_from_unit_id_org_units_id_fk" FOREIGN KEY ("routed_from_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."cases" ADD CONSTRAINT "cases_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."cases" ADD CONSTRAINT "cases_definition_version_id_workflow_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "workflow"."workflow_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_events_case_idx" ON "workflow"."case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_events_org_path_gist" ON "workflow"."case_events" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "case_tasks_open_uq" ON "workflow"."case_tasks" USING btree ("case_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "case_tasks_case_idx" ON "workflow"."case_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_tasks_org_path_gist" ON "workflow"."case_tasks" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "case_tasks_inbox_idx" ON "workflow"."case_tasks" USING btree ("unit_id","role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_number_uq" ON "workflow"."cases" USING btree ("region_id","number");--> statement-breakpoint
CREATE INDEX "cases_org_path_gist" ON "workflow"."cases" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "cases_state_idx" ON "workflow"."cases" USING btree ("region_id","state");