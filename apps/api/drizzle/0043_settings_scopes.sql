DROP INDEX "kernel"."settings_values_region_key_uq";--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
-- the values set before (task 0.13) were the region's: its root unit's
UPDATE "kernel"."settings_values" SET "unit_id" = "region_id";--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ALTER COLUMN "unit_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD COLUMN "unit_type_id" uuid;--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD CONSTRAINT "settings_values_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD CONSTRAINT "settings_values_unit_type_fk" FOREIGN KEY ("unit_type_id","region_id") REFERENCES "kernel"."unit_types"("id","region_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD CONSTRAINT "settings_values_scope_key_uq" UNIQUE NULLS NOT DISTINCT("unit_id","unit_type_id","key");--> statement-breakpoint
ALTER TABLE "kernel"."settings_values" ADD CONSTRAINT "settings_values_unit_type_at_root" CHECK ("kernel"."settings_values"."unit_type_id" is null or "kernel"."settings_values"."unit_id" = "kernel"."settings_values"."region_id");
