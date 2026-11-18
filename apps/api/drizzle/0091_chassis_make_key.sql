ALTER TABLE "vehicles"."vehicles" ADD COLUMN "make_key" text;--> statement-breakpoint
-- Hand-written (task 1.13j, ADR-0061): an 'other' chassis number is told apart by its make. The rows are unique on (region_id,
-- vin_key) today, so the backfill cannot collide. The SQL folding approximates contracts/vin.ts makeKey (the application writes the
-- key from now on); only development and demo data exists.
UPDATE "vehicles"."vehicles"
   SET "make_key" = left(coalesce(nullif(regexp_replace(upper(normalize("make", NFKC)), '[^[:alnum:]]', '', 'g'), ''), upper(btrim("make"))), 120)
 WHERE "chassis_kind" = 'other';--> statement-breakpoint
DROP INDEX "vehicles"."vehicles_vin_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_uq" ON "vehicles"."vehicles" USING btree ("region_id","vin_key") WHERE "vehicles"."vehicles"."chassis_kind" = 'iso3779';--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_other_chassis_uq" ON "vehicles"."vehicles" USING btree ("region_id","vin_key","make_key") WHERE "vehicles"."vehicles"."chassis_kind" = 'other';--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_make_key_check" CHECK (("vehicles"."vehicles"."chassis_kind" = 'other') = ("vehicles"."vehicles"."make_key" is not null) and coalesce(length("vehicles"."vehicles"."make_key"), 1) between 1 and 120);--> statement-breakpoint
GRANT UPDATE ("make_key") ON "vehicles"."vehicles" TO itrms_app;
--> statement-breakpoint
-- The open-case claim takes the make key (task 1.13j): an 'other' chassis claims on its key and its make, so a case for a vehicle of
-- another make does not hold this one. A case filed before this migration carries no make key in its facts and claims on the chassis
-- alone (the cautious side). The body of 0089 with the make condition on its three chassis arms. The signature changes, so the old
-- overload is dropped and the grants are made again.
DROP FUNCTION "competency"."vehicle_in_open_case"(text, text, uuid, uuid);
--> statement-breakpoint
CREATE FUNCTION "competency"."vehicle_in_open_case"(p_vin_key text, p_make_key text, p_plate_key text, p_vehicle_id uuid, p_except uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT kernel.ctx_region() IS NULL OR (
        EXISTS (SELECT 1 FROM workflow.cases c
                 WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                   AND p_vin_key IS NOT NULL AND (c.facts #>> '{registration,vinKey}') = p_vin_key
                   AND (p_make_key IS NULL OR (c.facts #>> '{registration,makeKey}') IS NULL
                        OR (c.facts #>> '{registration,makeKey}') = p_make_key))
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{backCapture,vinKey}') = p_vin_key
                      AND (p_make_key IS NULL OR (c.facts #>> '{backCapture,makeKey}') IS NULL
                           OR (c.facts #>> '{backCapture,makeKey}') = p_make_key))
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{backCapture,plateKey}') = p_plate_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{transferArrival,vinKey}') = p_vin_key
                      AND (p_make_key IS NULL OR (c.facts #>> '{transferArrival,makeKey}') IS NULL
                           OR (c.facts #>> '{transferArrival,makeKey}') = p_make_key))
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{transferArrival,plateKey}') = p_plate_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{exchange,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transfer,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transferOut,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                     JOIN vehicles.vehicle_handovers r ON r.id::text = (c.facts #>> '{transferIn,handoverId}')
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transferIn,vehicleId}') = p_vehicle_id::text
                      AND r.status = 'released' AND r.valid_until >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{cancelRelease,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM vehicles.vehicle_handovers h
                    WHERE h.region_id = kernel.ctx_region() AND p_vehicle_id IS NOT NULL AND h.vehicle_id = p_vehicle_id
                      AND h.status = 'released' AND h.valid_until >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
                      AND NOT EXISTS (SELECT 1 FROM workflow.cases x
                                       WHERE x.id = p_except AND x.handling_unit_id = h.to_unit_id))
    );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "competency"."vehicle_in_open_case"(text, text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "competency"."vehicle_in_open_case"(text, text, text, uuid, uuid) TO itrms_app;
