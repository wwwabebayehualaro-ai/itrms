ALTER TABLE "vehicles"."vehicle_handovers" ALTER COLUMN "to_unit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "destination_kind" text DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "destination_name" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD COLUMN "destination_region" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_kind_check" CHECK ("vehicles"."vehicle_handovers"."destination_kind" in ('office', 'outside'));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_destination_check" CHECK (("vehicles"."vehicle_handovers"."destination_kind" = 'office' and "vehicles"."vehicle_handovers"."to_unit_id" is not null and "vehicles"."vehicle_handovers"."destination_name" is null and "vehicles"."vehicle_handovers"."destination_region" is null) or ("vehicles"."vehicle_handovers"."destination_kind" = 'outside' and "vehicles"."vehicle_handovers"."to_unit_id" is null and "vehicles"."vehicle_handovers"."destination_name" is not null and length("vehicles"."vehicle_handovers"."destination_name") between 1 and 200 and coalesce(length("vehicles"."vehicle_handovers"."destination_region"), 1) between 1 and 100));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_outside_check" CHECK ("vehicles"."vehicle_handovers"."status" <> 'received' or "vehicles"."vehicle_handovers"."destination_kind" = 'office');
--> statement-breakpoint
-- Hand-written (task 1.4c2, ADR-0058): a release outside the region has no receiving office, so the trigger of 0086 compares
-- the destination with IS DISTINCT FROM (a NULL never reads as "unchanged by <>") and also holds the destination's kind, name and
-- region: what the document names never changes by hand. The grants stand: INSERT covers the new columns, UPDATE none of them.
CREATE OR REPLACE FUNCTION "vehicles"."check_handover_transition"() RETURNS trigger
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
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER "handover_transition" ON "vehicles"."vehicle_handovers";
--> statement-breakpoint
-- still not on the scope column: an org-unit move rewrites every row's from_org_path, and a final handover must survive it
CREATE TRIGGER "handover_transition" BEFORE INSERT OR UPDATE OF "status", "vehicle_id", "ownership_id", "from_unit_id",
    "to_unit_id", "destination_kind", "destination_name", "destination_region", "case_id", "released_on", "valid_until",
    "in_case_id", "received_on", "received_by"
    ON "vehicles"."vehicle_handovers"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_handover_transition"();
--> statement-breakpoint
-- Hand-written (task 1.4c2, ADR-0058): the ownership chain of 0064 closed every period of a vehicle that left the region. A vehicle
-- transferred out now keeps its owners as they were, so it may keep its one open period; one transferred out before kept none.
CREATE OR REPLACE FUNCTION "vehicles"."check_ownership_chain"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_status text;
    v_first date;
    periods integer;
    open_periods integer;
    wanted_open integer;
    first_since date;
BEGIN
    IF TG_TABLE_NAME = 'vehicles' THEN
        v_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'vehicle_ownerships' THEN
        v_id := NEW.vehicle_id;
    ELSE
        SELECT o.vehicle_id INTO v_id FROM vehicles.vehicle_ownerships o WHERE o.id = NEW.ownership_id;
    END IF;
    SELECT v.status, v.first_registered_on INTO v_status, v_first FROM vehicles.vehicles v WHERE v.id = v_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE o.until IS NULL), min(o.since)
      INTO periods, open_periods, first_since
      FROM vehicles.vehicle_ownerships o WHERE o.vehicle_id = v_id;
    IF periods = 0 THEN
        RAISE EXCEPTION 'vehicles: vehicle % has no owners on record', v_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ownership_chain';
    END IF;
    -- transferred out keeps its period open (ADR-0058, task 1.4c2), as stolen does; one taken out before kept none
    wanted_open := CASE WHEN v_status IN ('active', 'stolen') THEN 1 ELSE 0 END;
    IF v_status = 'transferred_out' AND open_periods <= 1 THEN
        wanted_open := open_periods;
    END IF;
    IF open_periods <> wanted_open THEN
        RAISE EXCEPTION 'vehicles: vehicle % (%) must have % open ownership period, has %',
            v_id, v_status, CASE wanted_open WHEN 1 THEN 'one' ELSE 'no' END, open_periods
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ownership_chain';
    END IF;
    IF first_since < v_first THEN
        RAISE EXCEPTION 'vehicles: the first owners of vehicle % took it before its first registration', v_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ownership_chain';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (
            SELECT o.since, lag(o.until) OVER w AS prev_until, row_number() OVER w AS n
              FROM vehicles.vehicle_ownerships o WHERE o.vehicle_id = v_id
            WINDOW w AS (ORDER BY o.since)
        ) s WHERE s.n > 1 AND s.prev_until IS DISTINCT FROM s.since
    ) THEN
        RAISE EXCEPTION 'vehicles: the ownership periods of vehicle % have a gap or an overlap', v_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ownership_chain';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vehicles.vehicle_ownerships o
         WHERE o.vehicle_id = v_id
           AND NOT EXISTS (SELECT 1 FROM vehicles.vehicle_owners w WHERE w.ownership_id = o.id)
    ) THEN
        RAISE EXCEPTION 'vehicles: an ownership period of vehicle % has no holder', v_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ownership_chain';
    END IF;
    RETURN NULL;
END;
$$;
