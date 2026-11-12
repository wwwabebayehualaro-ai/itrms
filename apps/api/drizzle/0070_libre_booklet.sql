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
--> statement-breakpoint
-- the booklet's serial is written on the libre when the booklet is issued (ADR-0050), and the vehicle's other facts corrected
GRANT UPDATE ("number", "national_reference") ON "vehicles"."libres" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("made_in", "engine_hp", "cylinders", "length_mm", "width_mm", "height_mm", "tyre_size", "tyres",
    "net_weight_kg") ON "vehicles"."vehicles" TO itrms_app;
--> statement-breakpoint
-- a libre is written in one booklet: once its serial is set, it never changes, whatever the writer
CREATE FUNCTION "vehicles"."libre_booklet_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
        RAISE EXCEPTION 'a libre''s booklet serial is set once (% → %)', OLD.number, NEW.number
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "libre_booklet_once" BEFORE UPDATE OF "number" ON "vehicles"."libres"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."libre_booklet_once"();
