ALTER TABLE "vehicles"."vehicle_handovers" DROP CONSTRAINT "vehicle_handovers_status_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "cancel_case_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "cancelled_on" date;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_handovers_cancel_case_uq" ON "vehicles"."vehicle_handovers" USING btree ("cancel_case_id") WHERE "vehicles"."vehicle_handovers"."cancel_case_id" is not null;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_cancelled_check" CHECK (("vehicles"."vehicle_handovers"."status" = 'cancelled') = ("vehicles"."vehicle_handovers"."cancel_case_id" is not null and "vehicles"."vehicle_handovers"."cancelled_on" is not null and "vehicles"."vehicle_handovers"."cancelled_by" is not null));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_status_check" CHECK ("vehicles"."vehicle_handovers"."status" in ('released', 'received', 'expired', 'cancelled'));
--> statement-breakpoint
-- Hand-written (task 1.4c2b, ADR-0059): a release is cancelled by its own case at the releasing office. `cancelled` is final, like
-- `received` and `expired`: the trigger of 0087 lets only a standing release leave `released`, and now also lets it go to
-- `cancelled` when the cancelling case is named: another case than the release's own, of the releasing office, whose facts name
-- this very release (the check effect wrote them on an earlier transition), today, by the caller. Whatever else is written for any
-- other status leaves the cancel columns as they were.
CREATE OR REPLACE FUNCTION "vehicles"."check_handover_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'released' OR NEW.in_case_id IS NOT NULL OR NEW.received_on IS NOT NULL OR NEW.received_by IS NOT NULL
            OR NEW.cancel_case_id IS NOT NULL OR NEW.cancelled_on IS NOT NULL OR NEW.cancelled_by IS NOT NULL
            OR NEW.released_on <> (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
            OR NEW.valid_until > NEW.released_on + 60 THEN
            RAISE EXCEPTION 'vehicles: a handover is released today, for at most 60 days, and received only by the command'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'released' OR NEW.status NOT IN ('released', 'received', 'expired', 'cancelled')
        OR NEW.vehicle_id <> OLD.vehicle_id OR NEW.from_unit_id <> OLD.from_unit_id
        OR NEW.to_unit_id IS DISTINCT FROM OLD.to_unit_id
        OR NEW.destination_kind <> OLD.destination_kind
        OR NEW.destination_name IS DISTINCT FROM OLD.destination_name
        OR NEW.destination_region IS DISTINCT FROM OLD.destination_region
        OR NEW.ownership_id <> OLD.ownership_id OR NEW.case_id <> OLD.case_id OR NEW.valid_until <> OLD.valid_until
        OR NEW.released_on <> OLD.released_on THEN
        RAISE EXCEPTION 'vehicles: handover % cannot go from % to %', OLD.id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
    END IF;
    IF NEW.status = 'cancelled' THEN
        -- the case's closed_at is not tested: the engine closes the case after its last effect ran
        IF NEW.cancel_case_id IS NULL OR NEW.cancel_case_id = OLD.case_id
            OR NEW.cancelled_on IS DISTINCT FROM (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
            OR NEW.cancelled_by IS DISTINCT FROM kernel.ctx_user()
            OR NOT EXISTS (SELECT 1 FROM workflow.cases c
                            WHERE c.id = NEW.cancel_case_id AND c.handling_unit_id = OLD.from_unit_id
                              AND (c.facts #>> '{cancelRelease,handoverId}') = OLD.id::text) THEN
            RAISE EXCEPTION 'vehicles: handover % is cancelled only by a case of its releasing office that names it, today', OLD.id
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
    ELSIF NEW.cancel_case_id IS DISTINCT FROM OLD.cancel_case_id OR NEW.cancelled_on IS DISTINCT FROM OLD.cancelled_on
        OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by THEN
        RAISE EXCEPTION 'vehicles: handover % cannot go from % to %', OLD.id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER "handover_transition" ON "vehicles"."vehicle_handovers";
--> statement-breakpoint
-- still not on the scope column (see 0087)
CREATE TRIGGER "handover_transition" BEFORE INSERT OR UPDATE OF "status", "vehicle_id", "ownership_id", "from_unit_id",
    "to_unit_id", "destination_kind", "destination_name", "destination_region", "case_id", "released_on", "valid_until",
    "in_case_id", "received_on", "received_by", "cancel_case_id", "cancelled_on", "cancelled_by"
    ON "vehicles"."vehicle_handovers"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_handover_transition"();
--> statement-breakpoint
GRANT UPDATE ("cancel_case_id", "cancelled_on", "cancelled_by") ON "vehicles"."vehicle_handovers" TO itrms_app;
--> statement-breakpoint
-- An open cancellation of a release claims the vehicle too (task 1.4c2b): another service's case for it is refused while one is
-- open. The body of 0086 with one arm more; same signature, so the grants and SECURITY DEFINER stand.
CREATE OR REPLACE FUNCTION "competency"."vehicle_in_open_case"(p_vin_key text, p_plate_key text, p_vehicle_id uuid, p_except uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT kernel.ctx_region() IS NULL OR (
        EXISTS (SELECT 1 FROM workflow.cases c
                 WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                   AND p_vin_key IS NOT NULL AND (c.facts #>> '{registration,vinKey}') = p_vin_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{backCapture,vinKey}') = p_vin_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{backCapture,plateKey}') = p_plate_key)
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
CREATE INDEX "cases_open_cancel_release_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{cancelRelease,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{cancelRelease,vehicleId}') IS NOT NULL;
--> statement-breakpoint
-- Whether an open case of the region names this release (task 1.4c2b): the receiving office's transfer in, or another cancellation.
-- The releasing office cannot read the destination's cases, so a yes or no is answered here, nothing else of them. With no context
-- (system work) it answers yes, as vehicle_in_open_case does.
CREATE FUNCTION "competency"."release_in_open_case"(p_handover uuid, p_vehicle_id uuid, p_except uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT kernel.ctx_region() IS NULL OR EXISTS (
        SELECT 1 FROM workflow.cases c
         WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
           AND (((c.facts #>> '{transferIn,vehicleId}') = p_vehicle_id::text
                 AND (c.facts #>> '{transferIn,handoverId}') = p_handover::text)
                OR (c.facts #>> '{cancelRelease,vehicleId}') = p_vehicle_id::text)
    );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "competency"."release_in_open_case"(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "competency"."release_in_open_case"(uuid, uuid, uuid) TO itrms_app;
