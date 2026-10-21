-- a row names a unit type of its own region only (the target of the composite keys comes first)
ALTER TABLE "kernel"."unit_types" ADD CONSTRAINT "unit_types_id_region_uq" UNIQUE("id","region_id");
--> statement-breakpoint
ALTER TABLE "kernel"."org_units" DROP CONSTRAINT "org_units_unit_type_id_unit_types_id_fk";
--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_roles" DROP CONSTRAINT "unit_type_roles_unit_type_id_unit_types_id_fk";
--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_services" DROP CONSTRAINT "unit_type_services_unit_type_id_unit_types_id_fk";
--> statement-breakpoint
ALTER TABLE "kernel"."org_units" ADD CONSTRAINT "org_units_unit_type_fk" FOREIGN KEY ("unit_type_id","region_id") REFERENCES "kernel"."unit_types"("id","region_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_roles" ADD CONSTRAINT "unit_type_roles_unit_type_fk" FOREIGN KEY ("unit_type_id","region_id") REFERENCES "kernel"."unit_types"("id","region_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_services" ADD CONSTRAINT "unit_type_services_unit_type_fk" FOREIGN KEY ("unit_type_id","region_id") REFERENCES "kernel"."unit_types"("id","region_id") ON DELETE no action ON UPDATE no action;
