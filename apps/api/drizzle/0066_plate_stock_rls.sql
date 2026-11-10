-- The stock of national plates (task 1.2a), hand-written: scope triggers, the plate's state machine as a trigger (no writer
-- can skip a step or move a plate sideways), a deferred check that a plate is 'assigned' exactly while a vehicle carries it,
-- grants (the ledger and the batches are insert-only; a plate changes only in the columns its life moves through; nothing
-- is deleted) and RLS: the batches and the ledger are class T of their unit, the plates class R of their holder (the region
-- reads them, the holder's line writes them). No SECURITY DEFINER function.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."plate_batches"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('receiving_unit_id', 'org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."plates"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('holder_unit_id', 'holder_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."plate_movements"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id', 'org_path');
--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements"
    ADD CONSTRAINT "plate_movements_of_fk" FOREIGN KEY ("of_movement_id") REFERENCES "vehicles"."plate_movements"("id");
--> statement-breakpoint
ALTER TABLE "vehicles"."plates"
    ADD CONSTRAINT "plates_last_movement_fk" FOREIGN KEY ("last_movement_id") REFERENCES "vehicles"."plate_movements"("id");
--> statement-breakpoint
-- The machine of contracts/plate-stock.ts. A plate is created in stock; only an allocation (to the unit below) and a recall
-- (back to the unit above) change its holder; retired, void and lost are final.
CREATE FUNCTION "vehicles"."check_plate_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    moved constant boolean := NEW.holder_unit_id IS DISTINCT FROM OLD.holder_unit_id;
    ok boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'in_stock' OR NEW.vehicle_id IS NOT NULL OR NEW.case_id IS NOT NULL THEN
            RAISE EXCEPTION 'vehicles: a plate enters the stock in stock'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'plate_transition';
        END IF;
        RETURN NEW;
    END IF;
    ok := CASE
        -- the same status: a note, never a new holder, vehicle or case
        WHEN NEW.status = OLD.status AND NOT (OLD.status = 'in_stock' AND moved) THEN
            NOT moved AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
                AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
                AND OLD.status NOT IN ('retired', 'void', 'lost')
        -- allocate (to the unit below), and recall (back above, from stock or from transit)
        WHEN OLD.status = 'in_stock' AND NEW.status = 'allocated' THEN moved
        WHEN OLD.status IN ('in_stock', 'allocated') AND NEW.status = 'in_stock' AND moved THEN true
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
CREATE TRIGGER "plate_transition" BEFORE INSERT OR UPDATE ON "vehicles"."plates"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_plate_transition"();
--> statement-breakpoint
-- At commit: a stock plate is 'assigned' exactly while one open plate assignment carries it, on its vehicle and with its key;
-- whatever wrote the rows.
CREATE FUNCTION "vehicles"."check_plate_match"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    p_id constant uuid := CASE WHEN TG_TABLE_NAME = 'plates' THEN NEW.id ELSE NEW.plate_id END;
    p record;
    open_count integer;
    matching integer;
BEGIN
    IF p_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT id, plate_key, status, vehicle_id INTO p FROM vehicles.plates WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'vehicles: plate assignment for a plate % that is not in the stock', p_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'plate_match';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE a.vehicle_id = p.vehicle_id AND a.plate_key = p.plate_key)
      INTO open_count, matching
      FROM vehicles.plate_assignments a WHERE a.plate_id = p_id AND a.until IS NULL;
    IF (p.status = 'assigned') <> (open_count = 1 AND matching = 1) OR open_count > 1 THEN
        RAISE EXCEPTION 'vehicles: plate % is % but % vehicle(s) carry it', p.plate_key, p.status, open_count
            USING ERRCODE = 'check_violation', CONSTRAINT = 'plate_match';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "plate_match" AFTER UPDATE OF "status", "vehicle_id" ON "vehicles"."plates"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_plate_match"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "plate_match" AFTER INSERT OR UPDATE OF "until", "plate_id" ON "vehicles"."plate_assignments"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_plate_match"();
--> statement-breakpoint
-- history is not deleted, and the ledger is not changed: SELECT and INSERT only, and a plate's own life in its columns
GRANT SELECT, INSERT ON "vehicles"."plate_batches", "vehicles"."plates", "vehicles"."plate_movements" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("holder_unit_id", "status", "status_on", "vehicle_id", "case_id", "end_reason", "note", "last_movement_id",
    "updated_at", "updated_by", "row_version")
    ON "vehicles"."plates" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.plate_batches', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.plates', 'registry', 'holder_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.plate_movements', 'transaction', 'org_path');
