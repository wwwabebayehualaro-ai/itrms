CREATE TABLE "vehicles"."vehicle_handovers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"ownership_id" uuid NOT NULL,
	"from_unit_id" uuid NOT NULL,
	"from_org_path" "ltree" DEFAULT '' NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"released_on" date NOT NULL,
	"released_by" uuid,
	"valid_until" date NOT NULL,
	"status" text DEFAULT 'released' NOT NULL,
	"in_case_id" uuid,
	"received_on" date,
	"received_by" uuid,
	CONSTRAINT "vehicle_handovers_status_check" CHECK ("vehicles"."vehicle_handovers"."status" in ('released', 'received', 'expired')),
	CONSTRAINT "vehicle_handovers_units_check" CHECK ("vehicles"."vehicle_handovers"."from_unit_id" <> "vehicles"."vehicle_handovers"."to_unit_id"),
	CONSTRAINT "vehicle_handovers_dates_check" CHECK ("vehicles"."vehicle_handovers"."valid_until" >= "vehicles"."vehicle_handovers"."released_on"),
	CONSTRAINT "vehicle_handovers_received_check" CHECK (("vehicles"."vehicle_handovers"."status" = 'received') = ("vehicles"."vehicle_handovers"."in_case_id" is not null and "vehicles"."vehicle_handovers"."received_on" is not null and "vehicles"."vehicle_handovers"."received_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" DROP CONSTRAINT "plate_movements_kind_check";--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" DROP CONSTRAINT "plate_movements_units_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_ownership_id_vehicle_ownerships_id_fk" FOREIGN KEY ("ownership_id") REFERENCES "vehicles"."vehicle_ownerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_from_unit_id_org_units_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_to_unit_id_org_units_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_handovers_case_uq" ON "vehicles"."vehicle_handovers" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_handovers_in_case_uq" ON "vehicles"."vehicle_handovers" USING btree ("in_case_id") WHERE "vehicles"."vehicle_handovers"."in_case_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_handovers_released_uq" ON "vehicles"."vehicle_handovers" USING btree ("vehicle_id") WHERE "vehicles"."vehicle_handovers"."status" = 'released';--> statement-breakpoint
CREATE INDEX "vehicle_handovers_to_idx" ON "vehicles"."vehicle_handovers" USING btree ("to_unit_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_handovers_from_gist" ON "vehicles"."vehicle_handovers" USING gist ("from_org_path");--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_kind_check" CHECK ("vehicles"."plate_movements"."kind" in ('receive', 'allocate', 'accept', 'recall', 'assign', 'retire', 'lose', 'write_off', 'hand_over_out', 'hand_over_in'));--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_units_check" CHECK (("vehicles"."plate_movements"."kind" in ('allocate', 'recall', 'hand_over_out', 'hand_over_in')) = ("vehicles"."plate_movements"."from_unit_id" is not null and "vehicles"."plate_movements"."to_unit_id" is not null));--> statement-breakpoint
-- Hand-written (task 1.4c, ADR-0057): a vehicle released by its office to another office of the region, and the reviewed command
-- that moves it on receipt. The region comes from the vehicle, the scope from the releasing office; the trigger names sort so the
-- region is set before the path is checked against it.
CREATE TRIGGER "inherit_vehicle_region" BEFORE INSERT ON "vehicles"."vehicle_handovers"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_region"();
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_handovers"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('from_unit_id', 'from_org_path');
--> statement-breakpoint
-- the releasing office writes a release and expires its own lapsed one; nothing else changes by hand: the receipt is the command's
GRANT SELECT, INSERT ON "vehicles"."vehicle_handovers" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "updated_at", "updated_by", "row_version") ON "vehicles"."vehicle_handovers" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_handovers', 'registry', 'from_org_path');
--> statement-breakpoint
-- A released handover becomes received only through the command, and expired only from released; a final one changes no more.
CREATE FUNCTION "vehicles"."check_handover_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'released' OR NEW.in_case_id IS NOT NULL OR NEW.received_on IS NOT NULL OR NEW.received_by IS NOT NULL
            OR NEW.released_on <> (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
            OR NEW.valid_until > NEW.released_on + 60 THEN
            RAISE EXCEPTION 'vehicles: a handover is released today, for at most 60 days, and received only by the command'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'released' OR NEW.status NOT IN ('released', 'received', 'expired')
        OR NEW.vehicle_id <> OLD.vehicle_id OR NEW.from_unit_id <> OLD.from_unit_id OR NEW.to_unit_id <> OLD.to_unit_id
        OR NEW.ownership_id <> OLD.ownership_id OR NEW.case_id <> OLD.case_id OR NEW.valid_until <> OLD.valid_until
        OR NEW.released_on <> OLD.released_on THEN
        RAISE EXCEPTION 'vehicles: handover % cannot go from % to %', OLD.id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_transition';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- not on the scope column: an org-unit move rewrites every row's from_org_path, and a final handover must survive it
CREATE TRIGGER "handover_transition" BEFORE INSERT OR UPDATE OF "status", "vehicle_id", "ownership_id", "from_unit_id",
    "to_unit_id", "case_id", "released_on", "valid_until", "in_case_id", "received_on", "received_by"
    ON "vehicles"."vehicle_handovers"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_handover_transition"();
--> statement-breakpoint
-- The plate machine of 0066 with one more move: an assigned plate follows its vehicle to the office that now handles it (a
-- handover), and only there. Before the "same status" branch, which would refuse a new holder.
CREATE OR REPLACE FUNCTION "vehicles"."check_plate_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    moved boolean;
    down boolean;
    up boolean;
    ok boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'in_stock' OR NEW.vehicle_id IS NOT NULL OR NEW.case_id IS NOT NULL THEN
            RAISE EXCEPTION 'vehicles: a plate enters the stock in stock'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'plate_transition';
        END IF;
        RETURN NEW;
    END IF;
    moved := NEW.holder_unit_id IS DISTINCT FROM OLD.holder_unit_id;
    down := moved AND EXISTS (SELECT 1 FROM kernel.org_units u WHERE u.id = NEW.holder_unit_id AND u.parent_id = OLD.holder_unit_id);
    up := moved AND EXISTS (SELECT 1 FROM kernel.org_units u WHERE u.id = OLD.holder_unit_id AND u.parent_id = NEW.holder_unit_id);
    ok := CASE
        -- a handover: the assigned plate goes with its vehicle, to the office that handles the vehicle now (task 1.4c)
        WHEN OLD.status = 'assigned' AND NEW.status = 'assigned' AND moved THEN
            NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
                AND EXISTS (SELECT 1 FROM vehicles.vehicles v
                             WHERE v.id = NEW.vehicle_id AND v.handling_unit_id = NEW.holder_unit_id)
        -- the same status: a note, never a new holder, vehicle or case
        WHEN NEW.status = OLD.status AND NOT (OLD.status = 'in_stock' AND moved) THEN
            NOT moved AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
                AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
                AND OLD.status NOT IN ('retired', 'void', 'lost')
        -- allocate (to the unit below), and recall (back above, from stock or from transit)
        WHEN OLD.status = 'in_stock' AND NEW.status = 'allocated' THEN down
        WHEN OLD.status IN ('in_stock', 'allocated') AND NEW.status = 'in_stock' AND moved THEN up
        -- accept: the unit below takes what it was sent
        WHEN OLD.status = 'allocated' AND NEW.status = 'in_stock' THEN NOT moved
        WHEN OLD.status = 'in_stock' AND NEW.status = 'reserved' THEN NOT moved
        WHEN OLD.status = 'reserved' AND NEW.status = 'in_stock' THEN NOT moved AND NEW.case_id IS NULL
        WHEN OLD.status IN ('in_stock', 'reserved') AND NEW.status = 'assigned' THEN NOT moved
            AND (OLD.status = 'in_stock' OR NEW.case_id IS NOT DISTINCT FROM OLD.case_id)
        WHEN OLD.status = 'assigned' AND NEW.status IN ('retired', 'lost') THEN NOT moved
            AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
        WHEN OLD.status IN ('in_stock', 'allocated') AND NEW.status IN ('void', 'lost') THEN NOT moved
        ELSE false
    END;
    IF NOT ok THEN
        RAISE EXCEPTION 'vehicles: plate % cannot go from % to % (new holder: %)', OLD.plate_key, OLD.status, NEW.status, moved
            USING ERRCODE = 'check_violation', CONSTRAINT = 'plate_transition';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- The receipt of a handover (task 1.4c, ADR-0057): the reviewed command a transfer in calls in its transaction. Neither office can
-- move a vehicle under the class R policy (the source may not write the new path, the destination may not reach the old one), so
-- this does it, for a release the source made through its paid and approved case, still standing, to an office in the caller's
-- scope, of a vehicle the source still handles with the owners it had. It moves the vehicle and its live rows (the open period and
-- its owners, the current plate, the libre in force, the stock plate with a ledger row at each office), never a closed one, and
-- returns every row it wrote so the caller audits each in the same transaction. Run again for the same case it returns nothing.
CREATE FUNCTION "vehicles"."accept_handover"(p_handover uuid, p_case uuid)
    RETURNS TABLE (tbl text, row_id uuid)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    h vehicles.vehicle_handovers%ROWTYPE;
    v vehicles.vehicles%ROWTYPE;
    dest public.ltree;
    today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
    who uuid := kernel.ctx_user();
    p record;
    m_out uuid;
    m_in uuid;
BEGIN
    IF kernel.ctx_region() IS NULL OR who IS NULL OR kernel.ctx_scope() IS NULL THEN
        RAISE EXCEPTION 'vehicles: a handover is received by a person' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO h FROM vehicles.vehicle_handovers WHERE id = p_handover FOR UPDATE;
    IF NOT FOUND OR h.region_id <> kernel.ctx_region() THEN
        RAISE EXCEPTION 'vehicles: no such handover' USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_not_open';
    END IF;
    IF h.status = 'received' AND h.in_case_id = p_case THEN
        RETURN;
    END IF;
    IF h.status <> 'released' THEN
        RAISE EXCEPTION 'vehicles: handover % is %', h.id, h.status USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_not_open';
    END IF;
    IF h.valid_until < today THEN
        RAISE EXCEPTION 'vehicles: handover % lapsed on %', h.id, h.valid_until
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_expired';
    END IF;
    SELECT u.path INTO dest FROM kernel.org_units u WHERE u.id = h.to_unit_id AND u.active;
    IF dest IS NULL OR NOT (dest <@ kernel.ctx_scope()) THEN
        RAISE EXCEPTION 'vehicles: the handover is not to an office of the caller' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v FROM vehicles.vehicles WHERE id = h.vehicle_id FOR UPDATE;
    IF v.status <> 'active' OR v.handling_unit_id <> h.from_unit_id THEN
        RAISE EXCEPTION 'vehicles: vehicle % is no longer the releasing office''s', v.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_not_open';
    END IF;
    -- the release is the source's transfer out, run to its release (paid and approved: its guards), for this vehicle and office
    IF NOT EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.id = h.case_id AND c.handling_unit_id = h.from_unit_id AND c.state = 'released'
                      AND (c.facts #>> '{transferOut,vehicleId}') = h.vehicle_id::text
                      AND (c.facts #>> '{transferOut,toUnitId}') = h.to_unit_id::text) THEN
        RAISE EXCEPTION 'vehicles: handover % was not released by a transfer out', h.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_not_open';
    END IF;
    -- the receipt is the destination's own open transfer in of this release
    IF NOT EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.id = p_case AND c.handling_unit_id = h.to_unit_id AND c.closed_at IS NULL
                      AND (c.facts #>> '{transferIn,handoverId}') = h.id::text) THEN
        RAISE EXCEPTION 'vehicles: case % is not the transfer in of handover %', p_case, h.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_not_yours';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicles.vehicle_ownerships o
                    WHERE o.id = h.ownership_id AND o.vehicle_id = v.id AND o.until IS NULL) THEN
        RAISE EXCEPTION 'vehicles: the owners of vehicle % changed since the release', v.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'handover_owners_changed';
    END IF;

    UPDATE vehicles.vehicles SET handling_unit_id = h.to_unit_id, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE id = v.id;
    RETURN QUERY SELECT 'vehicles.vehicles'::text, v.id;
    RETURN QUERY UPDATE vehicles.vehicle_ownerships SET handling_unit_id = h.to_unit_id, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE id = h.ownership_id RETURNING 'vehicles.vehicle_ownerships'::text, id;
    RETURN QUERY UPDATE vehicles.vehicle_owners SET handling_unit_id = h.to_unit_id, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE ownership_id = h.ownership_id RETURNING 'vehicles.vehicle_owners'::text, id;
    RETURN QUERY UPDATE vehicles.plate_assignments SET handling_unit_id = h.to_unit_id, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE vehicle_id = v.id AND until IS NULL
           RETURNING 'vehicles.plate_assignments'::text, id;
    RETURN QUERY UPDATE vehicles.libres SET handling_unit_id = h.to_unit_id, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE vehicle_id = v.id AND status = 'issued' RETURNING 'vehicles.libres'::text, id;

    FOR p IN SELECT s.id, s.plate_key FROM vehicles.plates s
               JOIN vehicles.plate_assignments a ON a.plate_id = s.id AND a.until IS NULL
              WHERE a.vehicle_id = v.id AND s.status = 'assigned' AND s.holder_unit_id = h.from_unit_id
                FOR UPDATE OF s LOOP
        INSERT INTO vehicles.plate_movements (id, region_id, unit_id, kind, from_unit_id, to_unit_id, quantity, first_key,
                    last_key, plate_id, vehicle_id, case_id, occurred_on, created_by, updated_by)
             VALUES (gen_random_uuid(), h.region_id, h.from_unit_id, 'hand_over_out', h.from_unit_id, h.to_unit_id, 1, p.plate_key,
                    p.plate_key, p.id, v.id, p_case, today, who, who)
          RETURNING id INTO m_out;
        INSERT INTO vehicles.plate_movements (id, region_id, unit_id, kind, from_unit_id, to_unit_id, quantity, first_key,
                    last_key, plate_id, vehicle_id, case_id, occurred_on, created_by, updated_by)
             VALUES (gen_random_uuid(), h.region_id, h.to_unit_id, 'hand_over_in', h.from_unit_id, h.to_unit_id, 1, p.plate_key,
                    p.plate_key, p.id, v.id, p_case, today, who, who)
          RETURNING id INTO m_in;
        UPDATE vehicles.plates SET holder_unit_id = h.to_unit_id, last_movement_id = m_in, updated_at = now(), updated_by = who,
               row_version = row_version + 1 WHERE id = p.id;
        RETURN QUERY SELECT 'vehicles.plate_movements'::text, m_out;
        RETURN QUERY SELECT 'vehicles.plate_movements'::text, m_in;
        RETURN QUERY SELECT 'vehicles.plates'::text, p.id;
    END LOOP;

    UPDATE vehicles.vehicle_handovers SET status = 'received', in_case_id = p_case, received_on = today, received_by = who,
           updated_at = now(), updated_by = who, row_version = row_version + 1 WHERE id = h.id;
    RETURN QUERY SELECT 'vehicles.vehicle_handovers'::text, h.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."accept_handover"(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."accept_handover"(uuid, uuid) TO itrms_app;
--> statement-breakpoint
-- A vehicle on its way claims it too (task 1.4c): an open transfer out or in names it, and a standing release does, except to
-- a case of the office it is released to (its own transfer in). Same signature: the grants and SECURITY DEFINER stand.
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
        OR EXISTS (SELECT 1 FROM vehicles.vehicle_handovers h
                    WHERE h.region_id = kernel.ctx_region() AND p_vehicle_id IS NOT NULL AND h.vehicle_id = p_vehicle_id
                      AND h.status = 'released' AND h.valid_until >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
                      AND NOT EXISTS (SELECT 1 FROM workflow.cases x
                                       WHERE x.id = p_except AND x.handling_unit_id = h.to_unit_id))
    );
$$;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_out_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transferOut,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transferOut,vehicleId}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_in_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transferIn,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transferIn,vehicleId}') IS NOT NULL;
--> statement-breakpoint
-- Where a vehicle may be released to (task 1.4c): an office of the caller's region, active, given the transfer in (its type's
-- default or its own override). A person reads only their subtree and ancestors of the tree, so a sibling office is answered
-- here: a yes or no, nothing else of the unit.
CREATE FUNCTION "vehicles"."handover_destination"(p_unit uuid, p_service text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce((
        SELECT u.active AND coalesce(
                   (SELECT o.enabled FROM kernel.unit_service_overrides o
                     WHERE o.org_unit_id = u.id AND o.service_code = p_service),
                   (SELECT s.enabled FROM kernel.unit_type_services s
                     WHERE s.unit_type_id = u.unit_type_id AND s.service_code = p_service),
                   false)
          FROM kernel.org_units u
         WHERE u.id = p_unit AND u.region_id = kernel.ctx_region()
    ), false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."handover_destination"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."handover_destination"(uuid, text) TO itrms_app;
--> statement-breakpoint
-- The offices a vehicle may be released to, for the transfer out's picker (task 1.4c): active offices of the caller's region,
-- other than the caller's, given the transfer in; by code or name. Ids, codes and names only.
CREATE FUNCTION "vehicles"."handover_destinations"(p_query text, p_service text, p_limit integer)
    RETURNS TABLE (id uuid, code text, name jsonb)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u.id, u.code, to_jsonb(u.name)
      FROM kernel.org_units u
     WHERE u.region_id = kernel.ctx_region() AND u.active AND u.id IS DISTINCT FROM kernel.ctx_unit()
       AND vehicles.handover_destination(u.id, p_service)
       AND (coalesce(p_query, '') = ''
            OR strpos(lower(u.code), lower(p_query)) > 0
            OR strpos(lower(coalesce(u.name ->> 'am', '')), lower(p_query)) > 0
            OR strpos(lower(coalesce(u.name ->> 'en', '')), lower(p_query)) > 0)
     ORDER BY u.code
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."handover_destinations"(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."handover_destinations"(text, text, integer) TO itrms_app;
