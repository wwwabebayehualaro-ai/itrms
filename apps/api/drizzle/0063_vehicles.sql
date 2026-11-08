CREATE SCHEMA "vehicles";
--> statement-breakpoint
CREATE TABLE "vehicles"."libres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"ownership_id" uuid NOT NULL,
	"number" text,
	"issued_on" date NOT NULL,
	"issuing_unit_id" uuid NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"replaces_id" uuid,
	"national_reference" text,
	"case_id" uuid,
	CONSTRAINT "libres_status_check" CHECK ("vehicles"."libres"."status" in ('issued', 'replaced', 'lost', 'cancelled')),
	CONSTRAINT "libres_text_check" CHECK (coalesce(length("vehicles"."libres"."number"), 1) between 1 and 40 and coalesce(length("vehicles"."libres"."national_reference"), 1) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."plate_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"plate_text" text NOT NULL,
	"plate_key" text NOT NULL,
	"format" text NOT NULL,
	"legacy_use_code" smallint,
	"legacy_region_code" text,
	"source" text NOT NULL,
	"since" date NOT NULL,
	"until" date,
	"ended_reason" text,
	CONSTRAINT "plate_assignments_format_check" CHECK ("vehicles"."plate_assignments"."format" in ('national', 'legacy', 'special')),
	CONSTRAINT "plate_assignments_source_check" CHECK ("vehicles"."plate_assignments"."source" in ('federal', 'legacy', 'manual')),
	CONSTRAINT "plate_assignments_reason_check" CHECK ("vehicles"."plate_assignments"."ended_reason" in ('exchanged', 'lost', 'retired', 'transferred')),
	CONSTRAINT "plate_assignments_key_check" CHECK ("vehicles"."plate_assignments"."plate_key" ~ '^[A-Z0-9]{3,40}$' and length("vehicles"."plate_assignments"."plate_text") <= 60),
	CONSTRAINT "plate_assignments_dates_check" CHECK ("vehicles"."plate_assignments"."until" is null or "vehicles"."plate_assignments"."until" >= "vehicles"."plate_assignments"."since"),
	CONSTRAINT "plate_assignments_ended_check" CHECK (("vehicles"."plate_assignments"."until" is null) = ("vehicles"."plate_assignments"."ended_reason" is null)),
	CONSTRAINT "plate_assignments_legacy_check" CHECK (("vehicles"."plate_assignments"."format" = 'legacy') = ("vehicles"."plate_assignments"."legacy_use_code" is not null) and ("vehicles"."plate_assignments"."legacy_use_code" is null or "vehicles"."plate_assignments"."legacy_use_code" between 1 and 5))
);
--> statement-breakpoint
CREATE TABLE "vehicles"."vehicle_categories" (
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
	"family" text NOT NULL,
	"needs_seats" boolean DEFAULT false NOT NULL,
	"needs_load" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vehicle_categories_key_check" CHECK ("vehicles"."vehicle_categories"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "vehicle_categories_family_check" CHECK ("vehicles"."vehicle_categories"."family" in ('passenger', 'freight', 'special')),
	CONSTRAINT "vehicle_categories_name_check" CHECK (jsonb_typeof("vehicles"."vehicle_categories"."name") = 'object' AND "vehicles"."vehicle_categories"."name" ? 'am' AND "vehicles"."vehicle_categories"."name" ? 'en' AND pg_column_size("vehicles"."vehicle_categories"."name") <= 4096)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."vehicle_owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"ownership_id" uuid NOT NULL,
	"person_id" uuid,
	"organisation_id" uuid,
	"ordinal" smallint NOT NULL,
	CONSTRAINT "vehicle_owners_one_holder_check" CHECK (("vehicles"."vehicle_owners"."person_id" is not null)::int + ("vehicles"."vehicle_owners"."organisation_id" is not null)::int = 1),
	CONSTRAINT "vehicle_owners_ordinal_check" CHECK ("vehicles"."vehicle_owners"."ordinal" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."vehicle_ownerships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"since" date NOT NULL,
	"until" date,
	"acquired_by" text NOT NULL,
	"case_id" uuid,
	"note" text,
	CONSTRAINT "vehicle_ownerships_dates_check" CHECK ("vehicles"."vehicle_ownerships"."until" is null or "vehicles"."vehicle_ownerships"."until" > "vehicles"."vehicle_ownerships"."since"),
	CONSTRAINT "vehicle_ownerships_acquired_check" CHECK ("vehicles"."vehicle_ownerships"."acquired_by" in ('first_registration', 'sale', 'inheritance', 'gift', 'court_order', 'auction', 'back_capture')),
	CONSTRAINT "vehicle_ownerships_note_check" CHECK (coalesce(length("vehicles"."vehicle_ownerships"."note"), 1) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"federal_vehicle_id" text,
	"federal_id_source" text,
	"chassis_number" text NOT NULL,
	"chassis_kind" text NOT NULL,
	"vin_key" text NOT NULL,
	"vin_check" text NOT NULL,
	"engine_number" text,
	"engine_key" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"model_year" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"use" text NOT NULL,
	"seats" integer,
	"load_capacity_kg" integer,
	"gross_weight_kg" integer,
	"engine_cc" integer,
	"axles" integer,
	"colour" text,
	"fuel" text,
	"first_registered_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "vehicles_federal_id_check" CHECK ("vehicles"."vehicles"."federal_vehicle_id" ~ '^[A-Z0-9-]{4,40}$'),
	CONSTRAINT "vehicles_federal_source_check" CHECK (("vehicles"."vehicles"."federal_vehicle_id" is null) = ("vehicles"."vehicles"."federal_id_source" is null)),
	CONSTRAINT "vehicles_chassis_check" CHECK (length("vehicles"."vehicles"."chassis_number") between 4 and 30 and length("vehicles"."vehicles"."vin_key") >= 4),
	CONSTRAINT "vehicles_model_year_check" CHECK ("vehicles"."vehicles"."model_year" between 1900 and 2100),
	CONSTRAINT "vehicles_use_check" CHECK ("vehicles"."vehicles"."use" in ('private', 'public_transport', 'commercial', 'government', 'ngo', 'diplomatic', 'international_org', 'police', 'defence')),
	CONSTRAINT "vehicles_status_check" CHECK ("vehicles"."vehicles"."status" in ('active', 'transferred_out', 'deregistered', 'stolen')),
	CONSTRAINT "vehicles_fuel_check" CHECK ("vehicles"."vehicles"."fuel" in ('petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'biofuel', 'other')),
	CONSTRAINT "vehicles_chassis_kind_check" CHECK ("vehicles"."vehicles"."chassis_kind" in ('iso3779', 'other')),
	CONSTRAINT "vehicles_vin_check_check" CHECK ("vehicles"."vehicles"."vin_check" in ('ok', 'mismatch', 'not_applicable')),
	CONSTRAINT "vehicles_federal_source_enum_check" CHECK ("vehicles"."vehicles"."federal_id_source" in ('national', 'manual')),
	CONSTRAINT "vehicles_figures_check" CHECK (coalesce("vehicles"."vehicles"."seats", 1) > 0 and coalesce("vehicles"."vehicles"."load_capacity_kg", 1) > 0 and coalesce("vehicles"."vehicles"."gross_weight_kg", 1) > 0
                        and coalesce("vehicles"."vehicles"."engine_cc", 1) > 0 and coalesce("vehicles"."vehicles"."axles", 1) > 0),
	CONSTRAINT "vehicles_text_check" CHECK (length("vehicles"."vehicles"."make") between 1 and 60 and length("vehicles"."vehicles"."model") between 1 and 60
                        and coalesce(length("vehicles"."vehicles"."engine_number"), 1) between 1 and 30 and coalesce(length("vehicles"."vehicles"."colour"), 1) between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "vehicles"."libres" ADD CONSTRAINT "libres_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."libres" ADD CONSTRAINT "libres_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."libres" ADD CONSTRAINT "libres_ownership_id_vehicle_ownerships_id_fk" FOREIGN KEY ("ownership_id") REFERENCES "vehicles"."vehicle_ownerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."libres" ADD CONSTRAINT "libres_issuing_unit_id_org_units_id_fk" FOREIGN KEY ("issuing_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_categories" ADD CONSTRAINT "vehicle_categories_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_owners" ADD CONSTRAINT "vehicle_owners_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_owners" ADD CONSTRAINT "vehicle_owners_ownership_id_vehicle_ownerships_id_fk" FOREIGN KEY ("ownership_id") REFERENCES "vehicles"."vehicle_ownerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "vehicles"."vehicle_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "libres_vehicle_idx" ON "vehicles"."libres" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "libres_number_uq" ON "vehicles"."libres" USING btree ("region_id","number") WHERE "vehicles"."libres"."number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "libres_issued_uq" ON "vehicles"."libres" USING btree ("vehicle_id") WHERE "vehicles"."libres"."status" = 'issued';--> statement-breakpoint
CREATE INDEX "libres_handling_gist" ON "vehicles"."libres" USING gist ("handling_org_path");--> statement-breakpoint
CREATE INDEX "plate_assignments_vehicle_idx" ON "vehicles"."plate_assignments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plate_assignments_open_plate_uq" ON "vehicles"."plate_assignments" USING btree ("region_id","plate_key") WHERE "vehicles"."plate_assignments"."until" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "plate_assignments_open_vehicle_uq" ON "vehicles"."plate_assignments" USING btree ("vehicle_id") WHERE "vehicles"."plate_assignments"."until" is null;--> statement-breakpoint
CREATE INDEX "plate_assignments_region_key_idx" ON "vehicles"."plate_assignments" USING btree ("region_id","plate_key");--> statement-breakpoint
CREATE INDEX "plate_assignments_key_trgm" ON "vehicles"."plate_assignments" USING gin ("plate_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "plate_assignments_handling_gist" ON "vehicles"."plate_assignments" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_categories_key_uq" ON "vehicles"."vehicle_categories" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "vehicle_categories_org_path_gist" ON "vehicles"."vehicle_categories" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_owners_ordinal_uq" ON "vehicles"."vehicle_owners" USING btree ("ownership_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_owners_person_uq" ON "vehicles"."vehicle_owners" USING btree ("ownership_id","person_id") WHERE "vehicles"."vehicle_owners"."person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_owners_organisation_uq" ON "vehicles"."vehicle_owners" USING btree ("ownership_id","organisation_id") WHERE "vehicles"."vehicle_owners"."organisation_id" is not null;--> statement-breakpoint
CREATE INDEX "vehicle_owners_person_idx" ON "vehicles"."vehicle_owners" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "vehicle_owners_organisation_idx" ON "vehicles"."vehicle_owners" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "vehicle_owners_handling_gist" ON "vehicles"."vehicle_owners" USING gist ("handling_org_path");--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_vehicle_idx" ON "vehicles"."vehicle_ownerships" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_ownerships_id_vehicle_uq" ON "vehicles"."vehicle_ownerships" USING btree ("id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_ownerships_open_uq" ON "vehicles"."vehicle_ownerships" USING btree ("vehicle_id") WHERE "vehicles"."vehicle_ownerships"."until" is null;--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_handling_gist" ON "vehicles"."vehicle_ownerships" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_federal_id_uq" ON "vehicles"."vehicles" USING btree ("region_id","federal_vehicle_id") WHERE "vehicles"."vehicles"."federal_vehicle_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_uq" ON "vehicles"."vehicles" USING btree ("region_id","vin_key");--> statement-breakpoint
CREATE INDEX "vehicles_region_vin_idx" ON "vehicles"."vehicles" USING btree ("region_id","vin_key");--> statement-breakpoint
CREATE INDEX "vehicles_region_engine_idx" ON "vehicles"."vehicles" USING btree ("region_id","engine_key");--> statement-breakpoint
CREATE INDEX "vehicles_vin_trgm" ON "vehicles"."vehicles" USING gin ("vin_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vehicles_engine_trgm" ON "vehicles"."vehicles" USING gin ("engine_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vehicles_handling_gist" ON "vehicles"."vehicles" USING gist ("handling_org_path");