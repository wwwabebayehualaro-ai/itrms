CREATE SCHEMA "services";
--> statement-breakpoint
CREATE TABLE "services"."service_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"process" integer NOT NULL,
	"module" text NOT NULL,
	"name" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "services"."service_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"unit_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"values" jsonb NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services"."service_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"service_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"form_version_id" uuid,
	"workflow_version_id" uuid NOT NULL,
	"fee_rule_version_id" uuid,
	"template_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb NOT NULL,
	"override_policy" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "services"."service_definitions" ADD CONSTRAINT "service_definitions_region_id_org_units_id_fk" FOREIGN KEY ("region_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services"."service_definitions" ADD CONSTRAINT "service_definitions_current_version_id_service_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "services"."service_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services"."service_overrides" ADD CONSTRAINT "service_overrides_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services"."service_overrides" ADD CONSTRAINT "service_overrides_service_id_service_definitions_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"."service_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services"."service_versions" ADD CONSTRAINT "service_versions_region_id_org_units_id_fk" FOREIGN KEY ("region_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services"."service_versions" ADD CONSTRAINT "service_versions_service_id_service_definitions_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"."service_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_definitions_code_uq" ON "services"."service_definitions" USING btree ("region_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "service_overrides_unit_service_uq" ON "services"."service_overrides" USING btree ("unit_id","service_id");--> statement-breakpoint
CREATE INDEX "service_overrides_org_path_gist" ON "services"."service_overrides" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "service_versions_number_uq" ON "services"."service_versions" USING btree ("service_id","number");--> statement-breakpoint
CREATE INDEX "service_versions_service_idx" ON "services"."service_versions" USING btree ("service_id","effective_from");