-- Task 1.2e, hand-written: the hardening from the 1.2b review.
--   competency.vehicle_in_open_case   a reviewed SECURITY DEFINER lookup, limited to the caller's region (kernel.ctx_region()):
--                                     whether another open case of the region claims a chassis, an old plate or a vehicle (a
--                                     registration, a back-capture or a plate exchange). Read through RLS the check saw only the
--                                     filer's subtree, so two sibling offices could both take a fee and hold a plate for one
--                                     vehicle. It answers yes or no: nothing of the other case is returned.
--   vehicles.search_vehicles          takes the status and owner filters, applied before the ranked limit (they were applied
--                                     to the top 50 afterwards, dropping a match ranked further down); the owner is the holder of
--                                     the vehicle's last ownership period, so a vehicle off the register is found by its last owner.
-- And the indexes of the open-case lookups and of the plates reserved for a case.
CREATE INDEX "cases_open_registration_vin_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{registration,vinKey}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{registration,vinKey}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cases_open_back_capture_vin_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{backCapture,vinKey}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{backCapture,vinKey}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cases_open_back_capture_plate_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{backCapture,plateKey}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{backCapture,plateKey}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cases_open_exchange_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{exchange,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{exchange,vehicleId}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "plates_reserved_case_idx" ON "vehicles"."plates" ("region_id", "case_id") WHERE "status" = 'reserved';
--> statement-breakpoint
-- p_vin_key: a chassis key as the API stores it; p_plate_key: an old plate's key; p_vehicle_id: a vehicle on the register;
-- p_except: the asking case. Any may be null. Static SQL, each arm on its partial index. Without a region it answers
-- "claimed": a caller that cannot be placed in a region never skips the check.
CREATE FUNCTION "competency"."vehicle_in_open_case"(p_vin_key text, p_plate_key text, p_vehicle_id uuid, p_except uuid)
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
    );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "competency"."vehicle_in_open_case"(text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "competency"."vehicle_in_open_case"(text, text, uuid, uuid) TO itrms_app;
--> statement-breakpoint
DROP FUNCTION "vehicles"."search_vehicles"(text, text, integer);
--> statement-breakpoint
-- As 0064's, with p_status (a vehicle status, or null) and p_owner (a person or organisation id, or null) applied to every hit
-- before the ranked limit. The part matches still read the first 1000 candidates of the trigram indexes.
CREATE FUNCTION "vehicles"."search_vehicles"(p_key text, p_plate_key text, p_limit integer, p_status text, p_owner uuid)
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
     WHERE (p_status IS NULL OR EXISTS (SELECT 1 FROM vehicles.vehicles v
                                         WHERE v.id = h.hit_id AND v.region_id = region AND v.status = p_status))
       AND (p_owner IS NULL OR EXISTS (
            SELECT 1 FROM vehicles.vehicle_owners w
             WHERE w.ownership_id = (SELECT o.id FROM vehicles.vehicle_ownerships o
                                      WHERE o.vehicle_id = h.hit_id AND o.region_id = region
                                      ORDER BY o.since DESC LIMIT 1)
               AND (w.person_id = p_owner OR w.organisation_id = p_owner)))
     ORDER BY h.rank, h.sim DESC, h.hit_id
     LIMIT lim;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."search_vehicles"(text, text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."search_vehicles"(text, text, integer, text, uuid) TO itrms_app;
