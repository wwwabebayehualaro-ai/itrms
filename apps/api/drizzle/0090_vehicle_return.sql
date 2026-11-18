ALTER TABLE "vehicles"."vehicle_handovers" DROP CONSTRAINT "vehicle_handovers_status_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" DROP CONSTRAINT "vehicle_handovers_outside_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" DROP CONSTRAINT "vehicle_handovers_received_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_status_check" CHECK ("vehicles"."vehicle_handovers"."status" in ('released', 'received', 'expired', 'cancelled', 'returned'));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_outside_check" CHECK (("vehicles"."vehicle_handovers"."status" <> 'received' or "vehicles"."vehicle_handovers"."destination_kind" = 'office') and ("vehicles"."vehicle_handovers"."status" <> 'returned' or "vehicles"."vehicle_handovers"."destination_kind" = 'outside'));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_received_check" CHECK (("vehicles"."vehicle_handovers"."status" in ('received', 'returned')) = ("vehicles"."vehicle_handovers"."in_case_id" is not null and "vehicles"."vehicle_handovers"."received_on" is not null and "vehicles"."vehicle_handovers"."received_by" is not null));
--> statement-breakpoint
-- Hand-written (task 1.4c3b, ADR-0060): a vehicle that left the region comes back through DVC-17 on its own record. `returned` is the
-- final status of the release outside the region it left on: it names the arrival case, the day and the person, as `received` does for
-- a release to an office (the checks above hold the shape: only an outside release ends so). The trigger of 0088 lets a lapsed outside
-- release go to `returned` only when the written case is an open DVC-17 case of the region whose facts name this very release,
-- today, by the caller; whatever else is written still leaves the release as it was. The engine runs a transition's effects before it
-- writes the case's state and closed_at, so the case is still open while its register effect runs: no state name is tested.
CREATE OR REPLACE FUNCTION "vehicles"."check_handover_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'released' OR NEW.in_case_id IS NOT NULL OR NEW.received_on IS NOT NULL OR NEW.received_by IS NOT NULL
            OR NEW.cancel_case_id IS NOT NULL OR NEW.cancelled_on IS NOT NULL OR NEW.cancelled_by IS NOT NULL
            OR NEW.released_on <> today
            OR NEW.valid_until > NEW.released_on + 60 THEN
            RAISE EXCEPTION 'vehicles: a handover is released today, for at most 60 days, and received only by the command'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'released' OR NEW.status NOT IN ('released', 'received', 'expired', 'cancelled', 'returned')
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
        -- the case is an open DVC-16 case: the engine runs a transition's effects before it writes the case's state and closed_at, so
        -- the case is still open while its cancel effect runs. No state name is tested: a bureau may rename its flow's states.
        IF NEW.cancel_case_id IS NULL OR NEW.cancel_case_id = OLD.case_id
            OR NEW.cancelled_on IS DISTINCT FROM today
            OR NEW.cancelled_by IS DISTINCT FROM kernel.ctx_user()
            OR NOT EXISTS (SELECT 1 FROM workflow.cases c
                            WHERE c.id = NEW.cancel_case_id AND c.handling_unit_id = OLD.from_unit_id
                              AND c.closed_at IS NULL AND (c.config ->> 'serviceCode') = 'DVC-16'
                              AND (c.facts #>> '{cancelRelease,handoverId}') = OLD.id::text) THEN
            RAISE EXCEPTION 'vehicles: handover % is cancelled only by a case of its releasing office that names it, today', OLD.id
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
    ELSIF NEW.status = 'expired' THEN
        -- only a release that lapsed expires: no request of the office can end a standing one
        IF OLD.valid_until >= today THEN
            RAISE EXCEPTION 'vehicles: handover % has not lapsed', OLD.id
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
    ELSIF NEW.status = 'returned' THEN
        IF OLD.destination_kind <> 'outside' OR OLD.valid_until >= today OR NEW.in_case_id IS NULL
            OR NEW.received_on IS DISTINCT FROM today
            OR NEW.received_by IS DISTINCT FROM kernel.ctx_user()
            OR NOT EXISTS (SELECT 1 FROM workflow.cases c
                            WHERE c.id = NEW.in_case_id AND c.region_id = OLD.region_id AND c.closed_at IS NULL
                              AND (c.config ->> 'serviceCode') = 'DVC-17'
                              AND (c.facts #>> '{transferArrival,returning,handoverId}') = OLD.id::text) THEN
            RAISE EXCEPTION 'vehicles: handover % is returned only by an arrival case that names it, once it has lapsed, today', OLD.id
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
-- The return of a vehicle (task 1.4c3b, ADR-0060): the reviewed command the DVC-17 register step calls in its transaction for a
-- vehicle of this region that left it. The region's class R policy lets no office move a vehicle another office handles, so this
-- does it, for the person's own open DVC-17 case, handled within the caller's scope, whose facts (the check effect wrote them on an
-- earlier transition) name this vehicle (by its chassis key) and the release it left on: the vehicle must read transferred_out, and
-- that release must stand, outside the region, lapsed, the vehicle's own and the case's; the case must be paid. It brings the vehicle back (active) to the
-- case's office and moves its live rows with it when that is another office (the open period and its owners, the current plate, the
-- libre in force, the stock plate with a ledger row at each office), never a closed one, ends the release `returned`, and returns
-- every row it wrote so the caller audits each in the same transaction. The owners, plate and libre the owner brings are the
-- registry commands' that follow it. Run again for the same case it returns nothing.
CREATE FUNCTION "vehicles"."accept_return"(p_case uuid)
    RETURNS TABLE (tbl text, row_id uuid)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c workflow.cases%ROWTYPE;
    h vehicles.vehicle_handovers%ROWTYPE;
    v vehicles.vehicles%ROWTYPE;
    dest public.ltree;
    open_id uuid;
    from_unit uuid;
    moved boolean;
    today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
    who uuid := kernel.ctx_user();
    p record;
    m_out uuid;
    m_in uuid;
BEGIN
    IF kernel.ctx_region() IS NULL OR who IS NULL OR kernel.ctx_scope() IS NULL THEN
        RAISE EXCEPTION 'vehicles: a return is registered by a person' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO c FROM workflow.cases WHERE id = p_case;
    IF NOT FOUND OR c.region_id <> kernel.ctx_region() OR (c.config ->> 'serviceCode') IS DISTINCT FROM 'DVC-17' THEN
        RAISE EXCEPTION 'vehicles: no such return' USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;
    IF EXISTS (SELECT 1 FROM vehicles.vehicle_handovers x WHERE x.in_case_id = p_case AND x.status = 'returned') THEN
        RETURN;
    END IF;
    IF c.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'vehicles: case % is closed', p_case USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;
    -- paid: the fact the workflow's PAID guard reads (payment.settled eq true; a case with no fee is settled when it is filed)
    IF (c.facts #>> '{payment,settled}') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'vehicles: case % is not paid', p_case USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;
    SELECT u.path INTO dest FROM kernel.org_units u
     WHERE u.id = c.handling_unit_id AND u.active AND u.region_id = kernel.ctx_region();
    -- the function's search_path leaves out public, where ltree's operators live: named in full
    IF dest IS NULL OR NOT (dest OPERATOR(public.<@) kernel.ctx_scope()) THEN
        RAISE EXCEPTION 'vehicles: the case is not handled within the caller''s scope' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v FROM vehicles.vehicles
     WHERE id::text = (c.facts #>> '{transferArrival,returning,vehicleId}') AND region_id = kernel.ctx_region() FOR UPDATE;
    IF NOT FOUND OR v.status <> 'transferred_out' OR v.vin_key IS DISTINCT FROM (c.facts #>> '{transferArrival,vinKey}') THEN
        RAISE EXCEPTION 'vehicles: case % does not return a vehicle that left the region', p_case
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;
    -- the release outside the region the vehicle left on (ADR-0058: a vehicle transferred out has one): still standing, lapsed, the
    -- vehicle's own, and the one the case names; with none there is nothing to come back on
    SELECT * INTO h FROM vehicles.vehicle_handovers WHERE vehicle_id = v.id AND status = 'released' FOR UPDATE;
    IF NOT FOUND
        OR (c.facts #>> '{transferArrival,returning,handoverId}') IS DISTINCT FROM h.id::text
        OR h.destination_kind <> 'outside' OR h.from_unit_id <> v.handling_unit_id OR h.valid_until >= today THEN
        RAISE EXCEPTION 'vehicles: vehicle % has no lapsed release outside the region that the case names', v.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;
    SELECT o.id INTO open_id FROM vehicles.vehicle_ownerships o WHERE o.vehicle_id = v.id AND o.until IS NULL;
    IF open_id IS NULL THEN
        RAISE EXCEPTION 'vehicles: vehicle % has no owners on record', v.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_return_refused';
    END IF;

    from_unit := v.handling_unit_id;
    moved := from_unit <> c.handling_unit_id;
    UPDATE vehicles.vehicles SET handling_unit_id = c.handling_unit_id, status = 'active', updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE id = v.id;
    RETURN QUERY SELECT 'vehicles.vehicles'::text, v.id;
    IF moved THEN
        RETURN QUERY UPDATE vehicles.vehicle_ownerships SET handling_unit_id = c.handling_unit_id, updated_at = now(), updated_by = who,
               row_version = row_version + 1 WHERE id = open_id RETURNING 'vehicles.vehicle_ownerships'::text, id;
        RETURN QUERY UPDATE vehicles.vehicle_owners SET handling_unit_id = c.handling_unit_id, updated_at = now(), updated_by = who,
               row_version = row_version + 1 WHERE ownership_id = open_id RETURNING 'vehicles.vehicle_owners'::text, id;
        RETURN QUERY UPDATE vehicles.plate_assignments SET handling_unit_id = c.handling_unit_id, updated_at = now(), updated_by = who,
               row_version = row_version + 1 WHERE vehicle_id = v.id AND until IS NULL
               RETURNING 'vehicles.plate_assignments'::text, id;
        RETURN QUERY UPDATE vehicles.libres SET handling_unit_id = c.handling_unit_id, updated_at = now(), updated_by = who,
               row_version = row_version + 1 WHERE vehicle_id = v.id AND status = 'issued' RETURNING 'vehicles.libres'::text, id;

        FOR p IN SELECT s.id, s.plate_key FROM vehicles.plates s
                   JOIN vehicles.plate_assignments a ON a.plate_id = s.id AND a.until IS NULL
                  WHERE a.vehicle_id = v.id AND s.status = 'assigned' AND s.holder_unit_id = from_unit
                    FOR UPDATE OF s LOOP
            INSERT INTO vehicles.plate_movements (id, region_id, unit_id, kind, from_unit_id, to_unit_id, quantity, first_key,
                        last_key, plate_id, vehicle_id, case_id, occurred_on, created_by, updated_by)
                 VALUES (gen_random_uuid(), v.region_id, from_unit, 'hand_over_out', from_unit, c.handling_unit_id, 1, p.plate_key,
                        p.plate_key, p.id, v.id, p_case, today, who, who)
              RETURNING id INTO m_out;
            INSERT INTO vehicles.plate_movements (id, region_id, unit_id, kind, from_unit_id, to_unit_id, quantity, first_key,
                        last_key, plate_id, vehicle_id, case_id, occurred_on, created_by, updated_by)
                 VALUES (gen_random_uuid(), v.region_id, c.handling_unit_id, 'hand_over_in', from_unit, c.handling_unit_id, 1, p.plate_key,
                        p.plate_key, p.id, v.id, p_case, today, who, who)
              RETURNING id INTO m_in;
            UPDATE vehicles.plates SET holder_unit_id = c.handling_unit_id, last_movement_id = m_in, updated_at = now(), updated_by = who,
                   row_version = row_version + 1 WHERE id = p.id;
            RETURN QUERY SELECT 'vehicles.plate_movements'::text, m_out;
            RETURN QUERY SELECT 'vehicles.plate_movements'::text, m_in;
            RETURN QUERY SELECT 'vehicles.plates'::text, p.id;
        END LOOP;
    END IF;

    UPDATE vehicles.vehicle_handovers SET status = 'returned', in_case_id = p_case, received_on = today, received_by = who,
           updated_at = now(), updated_by = who, row_version = row_version + 1 WHERE id = h.id;
    RETURN QUERY SELECT 'vehicles.vehicle_handovers'::text, h.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."accept_return"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."accept_return"(uuid) TO itrms_app;
--> statement-breakpoint
-- A vehicle's return claims its release (task 1.4c3b): another case of the region for it, the cancellation of the release (task
-- 1.4c2b) included, is refused while a return naming the release is open. The body of 0088 with one arm more; same signature, so the
-- grants and SECURITY DEFINER stand.
CREATE OR REPLACE FUNCTION "competency"."release_in_open_case"(p_handover uuid, p_vehicle_id uuid, p_except uuid)
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
                OR (c.facts #>> '{cancelRelease,vehicleId}') = p_vehicle_id::text
                OR (c.facts #>> '{transferArrival,returning,handoverId}') = p_handover::text)
    );
$$;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_arrival_return_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transferArrival,returning,handoverId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transferArrival,returning,handoverId}') IS NOT NULL;
