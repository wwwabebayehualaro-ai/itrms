ALTER TABLE "kernel"."org_departments" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."org_level_definitions" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."unit_service_overrides" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_roles" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_services" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."unit_types" ADD COLUMN "org_path" "ltree" DEFAULT '' NOT NULL;