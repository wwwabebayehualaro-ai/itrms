CREATE TABLE "kernel"."org_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"key" text NOT NULL,
	"process" text,
	"name" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."org_level_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."org_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"parent_id" uuid,
	"path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"level_key" text NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"category" text,
	"unit_type_id" uuid,
	"keycloak_group_id" text,
	"to_confirm" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."unit_service_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."unit_type_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_type_id" uuid NOT NULL,
	"role_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."unit_type_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_type_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."unit_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"level_key" text NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"departments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kernel"."org_departments" ADD CONSTRAINT "org_departments_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."org_level_definitions" ADD CONSTRAINT "org_level_definitions_region_id_org_units_id_fk" FOREIGN KEY ("region_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."org_units" ADD CONSTRAINT "org_units_unit_type_id_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "kernel"."unit_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_service_overrides" ADD CONSTRAINT "unit_service_overrides_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_roles" ADD CONSTRAINT "unit_type_roles_unit_type_id_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "kernel"."unit_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_services" ADD CONSTRAINT "unit_type_services_unit_type_id_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "kernel"."unit_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_types" ADD CONSTRAINT "unit_types_region_id_org_units_id_fk" FOREIGN KEY ("region_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_departments_key_uq" ON "kernel"."org_departments" USING btree ("org_unit_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_level_definitions_key_uq" ON "kernel"."org_level_definitions" USING btree ("region_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_code_uq" ON "kernel"."org_units" USING btree ("region_id","code");--> statement-breakpoint
CREATE INDEX "org_units_path_gist" ON "kernel"."org_units" USING gist ("path");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "kernel"."org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_service_overrides_uq" ON "kernel"."unit_service_overrides" USING btree ("org_unit_id","service_code");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_type_roles_uq" ON "kernel"."unit_type_roles" USING btree ("unit_type_id","role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_type_services_uq" ON "kernel"."unit_type_services" USING btree ("unit_type_id","service_code");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_types_key_uq" ON "kernel"."unit_types" USING btree ("region_id","key");