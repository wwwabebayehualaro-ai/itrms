ALTER TABLE "vehicles"."vehicles" ADD COLUMN "made_in" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "engine_hp" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "cylinders" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "tyre_size" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "tyres" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "net_weight_kg" integer;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_details_check" CHECK (coalesce("vehicles"."vehicles"."engine_hp", 1) > 0 and coalesce("vehicles"."vehicles"."cylinders", 1) > 0 and coalesce("vehicles"."vehicles"."length_mm", 1) > 0
                        and coalesce("vehicles"."vehicles"."width_mm", 1) > 0 and coalesce("vehicles"."vehicles"."height_mm", 1) > 0 and coalesce("vehicles"."vehicles"."tyres", 1) > 0
                        and coalesce("vehicles"."vehicles"."net_weight_kg", 1) > 0 and coalesce(length("vehicles"."vehicles"."made_in"), 1) between 1 and 60
                        and coalesce(length("vehicles"."vehicles"."tyre_size"), 1) between 1 and 20);--> statement-breakpoint
-- ADR-0050: the libre is the federal booklet, numbered by its serial; the office counter of ADR-0049 numbers the
-- registration certificate (the temporary libre) from now on, carrying on from where it stood
UPDATE "kernel"."number_counters"
   SET "key" = 'vehicles.registration-certificate',
       "pattern" = CASE WHEN "pattern" = '{unit}/LB/{seq:06}' THEN '{unit}/RC/{seq:06}' ELSE "pattern" END
 WHERE "key" = 'vehicles.libre';
