CREATE SCHEMA "workflow";
--> statement-breakpoint
CREATE TABLE "workflow"."workflow_definition_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"definition_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"definition" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow"."workflow_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"latest_version_id" uuid
);
--> statement-breakpoint
ALTER TABLE "workflow"."workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "workflow"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_latest_version_id_workflow_definition_versions_id_fk" FOREIGN KEY ("latest_version_id") REFERENCES "workflow"."workflow_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definition_versions_content_uq" ON "workflow"."workflow_definition_versions" USING btree ("definition_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definition_versions_number_uq" ON "workflow"."workflow_definition_versions" USING btree ("definition_id","number");--> statement-breakpoint
CREATE INDEX "workflow_definition_versions_org_path_gist" ON "workflow"."workflow_definition_versions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_key_uq" ON "workflow"."workflow_definitions" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "workflow_definitions_org_path_gist" ON "workflow"."workflow_definitions" USING gist ("org_path");