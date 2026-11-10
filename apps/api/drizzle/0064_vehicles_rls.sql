-- The vehicle register (task 1.1a), hand-written: scope triggers, the foreign keys to the people register, the exclusion and
-- constraint triggers that keep a vehicle's ownership history whole, grants, RLS, and one reviewed SECURITY DEFINER function
-- limited to the caller's region (kernel.ctx_region(), the signed request context):
--   vehicles.search_vehicles   the ranked search by federal id, chassis number, plate (current or old) and engine number,
--                              on the trigram and btree indexes; ids and the way each was matched only: the records
--                              themselves are then read under RLS.
-- A child row (ownership, holder, plate, libre) takes its region and handling unit from its vehicle in a trigger, so a unit
-- cannot write a child for a vehicle it does not handle: the class R policies see the vehicle's scope.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_categories"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicles"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_ownerships"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_owners"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."plate_assignments"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."libres"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE FUNCTION "vehicles"."inherit_vehicle_unit"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    parent_region uuid;
    parent_unit uuid;
BEGIN
    IF TG_ARGV[0] = 'ownership' THEN
        SELECT o.region_id, o.handling_unit_id INTO parent_region, parent_unit
          FROM vehicles.vehicle_ownerships o WHERE o.id = NEW.ownership_id;
    ELSE
        SELECT v.region_id, v.handling_unit_id INTO parent_region, parent_unit
          FROM vehicles.vehicles v WHERE v.id = NEW.vehicle_id;
    END IF;
    IF parent_unit IS NULL THEN
        RAISE EXCEPTION 'vehicles: the vehicle is not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.region_id := parent_region;
    NEW.handling_unit_id := parent_unit;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- the trigger name sorts before set_org_path, so the scope column is derived from the inherited unit
CREATE TRIGGER "inherit_vehicle_unit" BEFORE INSERT ON "vehicles"."vehicle_ownerships"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_unit"('vehicle');
--> statement-breakpoint
CREATE TRIGGER "inherit_vehicle_unit" BEFORE INSERT ON "vehicles"."plate_assignments"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_unit"('vehicle');
--> statement-breakpoint
CREATE TRIGGER "inherit_vehicle_unit" BEFORE INSERT ON "vehicles"."libres"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_unit"('vehicle');
--> statement-breakpoint
CREATE TRIGGER "inherit_vehicle_unit" BEFORE INSERT ON "vehicles"."vehicle_owners"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_unit"('ownership');
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_owners"
    ADD CONSTRAINT "vehicle_owners_person_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id"),
    ADD CONSTRAINT "vehicle_owners_organisation_fk" FOREIGN KEY ("organisation_id") REFERENCES "parties"."organisations"("id");
--> statement-breakpoint
ALTER TABLE "vehicles"."libres"
    ADD CONSTRAINT "libres_replaces_fk" FOREIGN KEY ("replaces_id") REFERENCES "vehicles"."libres"("id"),
    ADD CONSTRAINT "libres_ownership_vehicle_fk" FOREIGN KEY ("ownership_id", "vehicle_id")
        REFERENCES "vehicles"."vehicle_ownerships"("id", "vehicle_id");
--> statement-breakpoint
-- no two periods of one vehicle overlap (a closed period ends the day the next begins: [since, until))
ALTER TABLE "vehicles"."vehicle_ownerships"
    ADD CONSTRAINT "vehicle_ownerships_no_overlap"
        EXCLUDE USING gist ("vehicle_id" WITH =, daterange("since", "until", '[)') WITH &&);
--> statement-breakpoint
-- The ownership history is whole when the transaction commits: periods with no gap and no overlap, the first not before the
-- vehicle's first registration, exactly one open while the vehicle is active or stolen and none otherwise, a holder in each period.
-- Deferred, because a transfer closes one period and opens the next in two statements.
CREATE FUNCTION "vehicles"."check_ownership_chain"() RETURNS trigger
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
    wanted_open := CASE WHEN v_status IN ('active', 'stolen') THEN 1 ELSE 0 END;
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
--> statement-breakpoint
-- only on the columns the chain is made of: an org-unit move rewrites every row's handling path, and needs no chain check
CREATE CONSTRAINT TRIGGER "ownership_chain" AFTER INSERT OR UPDATE OF "vehicle_id", "since", "until" ON "vehicles"."vehicle_ownerships"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_ownership_chain"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ownership_chain" AFTER INSERT OR UPDATE OF "ownership_id", "person_id", "organisation_id" ON "vehicles"."vehicle_owners"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_ownership_chain"();
--> statement-breakpoint
-- a vehicle registered without owners, or taken off the register with a period still open, is as wrong as a gap
CREATE CONSTRAINT TRIGGER "ownership_chain" AFTER INSERT OR UPDATE OF "status" ON "vehicles"."vehicles"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_ownership_chain"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "vehicles" TO itrms_app;
--> statement-breakpoint
-- history is not deleted: the grants have no DELETE; a record changes only in the columns its life moves through
GRANT SELECT, INSERT ON "vehicles"."vehicle_categories", "vehicles"."vehicles", "vehicles"."vehicle_ownerships",
    "vehicles"."vehicle_owners", "vehicles"."plate_assignments", "vehicles"."libres" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "family", "needs_seats", "needs_load", "active", "updated_at", "updated_by", "row_version")
    ON "vehicles"."vehicle_categories" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("federal_vehicle_id", "federal_id_source", "chassis_number", "chassis_kind", "vin_key", "vin_check",
    "engine_number", "engine_key", "make", "model", "model_year", "category_id", "use", "seats", "load_capacity_kg",
    "gross_weight_kg", "engine_cc", "axles", "colour", "fuel", "status", "updated_at", "updated_by", "row_version")
    ON "vehicles"."vehicles" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("until", "updated_at", "updated_by", "row_version") ON "vehicles"."vehicle_ownerships" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("until", "ended_reason", "updated_at", "updated_by", "row_version")
    ON "vehicles"."plate_assignments" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "updated_at", "updated_by", "row_version") ON "vehicles"."libres" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_categories', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicles', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_ownerships', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_owners', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.plate_assignments', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.libres', 'registry', 'handling_org_path');
--> statement-breakpoint
-- p_key: what the person typed, upper case, letters, digits and hyphens (a federal id may hold hyphens); p_plate_key: the
-- same read as a plate (the API's parsePlate, else the folded text). The chassis and engine keys are derived here the way
-- the API stores them (letters and digits, I as 1, O and Q as 0), so a lower-case VIN with spaces and an O for a 0 is found.
-- Ranked: exact federal id, exact chassis number, current plate, old plate, engine number, then a part of a chassis number
-- (5 characters or more) or of a plate (3 or more) from the trigram indexes, the first 1000 found ranked by similarity.
-- A vehicle is returned once, by its best match. Static SQL; the LIKE patterns have % _ \ escaped.
CREATE FUNCTION "vehicles"."search_vehicles"(p_key text, p_plate_key text, p_limit integer)
    RETURNS TABLE (vehicle_id uuid, matched text)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := kernel.ctx_region();
    lim constant integer := least(greatest(coalesce(p_limit, 20), 1), 50);
    raw_key constant text := left(coalesce(p_key, ''), 60);
    vkey constant text := translate(regexp_replace(raw_key, '[^A-Z0-9]', '', 'g'), 'IOQ', '100');
    pkey constant text := regexp_replace(left(coalesce(p_plate_key, ''), 60), '[^A-Z0-9]', '', 'g');
    vlike constant text := '%' || replace(replace(replace(vkey, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    plike constant text := '%' || replace(replace(replace(pkey, '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
    IF region IS NULL OR (length(vkey) < 3 AND length(pkey) < 3) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT h.hit_id, h.how
      FROM (
        SELECT DISTINCT ON (hits.hit_id) hits.hit_id, hits.how, hits.rank, hits.sim
          FROM (
            SELECT v.id AS hit_id, 'federal_id'::text AS how, 1 AS rank, 1::real AS sim
              FROM vehicles.vehicles v
             WHERE v.region_id = region AND length(raw_key) >= 4 AND v.federal_vehicle_id = raw_key
            UNION ALL
            SELECT v.id, 'vin', 2, 1::real
              FROM vehicles.vehicles v
             WHERE v.region_id = region AND length(vkey) >= 4 AND v.vin_key = vkey
            UNION ALL
            SELECT p.vehicle_id, 'plate', 3, 1::real
              FROM vehicles.plate_assignments p
             WHERE p.region_id = region AND length(pkey) >= 3 AND p.plate_key = pkey AND p.until IS NULL
            UNION ALL
            SELECT p.vehicle_id, 'old_plate', 4, 1::real
              FROM vehicles.plate_assignments p
             WHERE p.region_id = region AND length(pkey) >= 3 AND p.plate_key = pkey AND p.until IS NOT NULL
            UNION ALL
            SELECT v.id, 'engine', 5, 1::real
              FROM vehicles.vehicles v
             WHERE v.region_id = region AND length(vkey) >= 4 AND v.engine_key = vkey
            UNION ALL
            SELECT c.id, 'vin_part', 6, public.similarity(c.vin_key, vkey)
              FROM (SELECT v.id, v.vin_key FROM vehicles.vehicles v
                     WHERE v.region_id = region AND length(vkey) >= 5 AND v.vin_key LIKE vlike LIMIT 1000) c
            UNION ALL
            SELECT c.vehicle_id, 'plate_part', 7, public.similarity(c.plate_key, pkey)
              FROM (SELECT p.vehicle_id, p.plate_key FROM vehicles.plate_assignments p
                     WHERE p.region_id = region AND length(pkey) >= 3 AND p.plate_key LIKE plike LIMIT 1000) c
          ) hits
         ORDER BY hits.hit_id, hits.rank, hits.sim DESC
      ) h
     ORDER BY h.rank, h.sim DESC, h.hit_id
     LIMIT lim;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."search_vehicles"(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."search_vehicles"(text, text, integer) TO itrms_app;
