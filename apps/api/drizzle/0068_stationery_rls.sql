-- Controlled stationery (task 1.12a), hand-written: scope triggers, the item's state machine as a trigger (no writer can
-- skip a step or move an item sideways), grants (the batches, the ledger and the closings are insert-only; an item changes
-- only in the columns its life moves through; nothing is deleted) and RLS: the batches, the ledger and the closings are
-- class T of their unit, the items class R of their holder (the region reads a serial, the holder's line writes it). No
-- SECURITY DEFINER function. A licence print batch item keeps the card blank it was printed on.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."stationery_batches"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('receiving_unit_id', 'org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."stationery_items"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('holder_unit_id', 'holder_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."stationery_movements"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id', 'org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."stationery_closings"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id', 'org_path');
--> statement-breakpoint
ALTER TABLE "fees"."stationery_movements"
    ADD CONSTRAINT "stationery_movements_of_fk" FOREIGN KEY ("of_movement_id") REFERENCES "fees"."stationery_movements"("id");
--> statement-breakpoint
ALTER TABLE "fees"."stationery_items"
    ADD CONSTRAINT "stationery_items_last_movement_fk" FOREIGN KEY ("last_movement_id") REFERENCES "fees"."stationery_movements"("id");
--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items"
    ADD CONSTRAINT "licence_print_batch_items_stationery_fk" FOREIGN KEY ("stationery_item_id") REFERENCES "fees"."stationery_items"("id");
--> statement-breakpoint
-- The machine of contracts/stationery.ts. An item is created in stock; only an allocation (to the unit below) and a recall
-- (back to the unit above) change its holder; used, spoiled, void and missing are final. What used an item never changes.
CREATE FUNCTION "fees"."check_stationery_transition"() RETURNS trigger
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
        IF NEW.status <> 'in_stock' OR NEW.used_for_id IS NOT NULL OR NEW.case_id IS NOT NULL THEN
            RAISE EXCEPTION 'fees: an item of stationery enters the stock in stock'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'stationery_transition';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.series IS DISTINCT FROM OLD.series OR NEW.serial IS DISTINCT FROM OLD.serial
        OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.variant IS DISTINCT FROM OLD.variant
        OR NEW.valid_efy IS DISTINCT FROM OLD.valid_efy THEN
        RAISE EXCEPTION 'fees: an item of stationery keeps its serial'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'stationery_transition';
    END IF;
    moved := NEW.holder_unit_id IS DISTINCT FROM OLD.holder_unit_id;
    down := moved AND EXISTS (SELECT 1 FROM kernel.org_units u WHERE u.id = NEW.holder_unit_id AND u.parent_id = OLD.holder_unit_id);
    up := moved AND EXISTS (SELECT 1 FROM kernel.org_units u WHERE u.id = OLD.holder_unit_id AND u.parent_id = NEW.holder_unit_id);
    ok := CASE
        -- the same status: a note, never a new holder, use or case; nothing changes on a final item
        WHEN NEW.status = OLD.status AND NOT (OLD.status = 'in_stock' AND moved) THEN
            NOT moved AND NEW.used_for_id IS NOT DISTINCT FROM OLD.used_for_id
                AND NEW.used_for_table IS NOT DISTINCT FROM OLD.used_for_table
                AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
                AND OLD.status NOT IN ('used', 'spoiled', 'void', 'missing')
        -- allocate (to the unit below), and recall (back above, from stock or from transit)
        WHEN OLD.status = 'in_stock' AND NEW.status = 'allocated' THEN down
        WHEN OLD.status IN ('in_stock', 'allocated') AND NEW.status = 'in_stock' AND moved THEN up
        -- accept: the unit below takes what it was sent
        WHEN OLD.status = 'allocated' AND NEW.status = 'in_stock' THEN NOT moved
        -- used once, for one record; spoiled with a reason
        WHEN OLD.status = 'in_stock' AND NEW.status = 'used' THEN NOT moved AND NEW.used_for_id IS NOT NULL
        WHEN OLD.status = 'in_stock' AND NEW.status = 'spoiled' THEN NOT moved AND NEW.used_for_id IS NULL
        WHEN OLD.status IN ('in_stock', 'allocated') AND NEW.status IN ('void', 'missing') THEN NOT moved
            AND NEW.used_for_id IS NULL
        ELSE false
    END;
    IF NOT ok THEN
        RAISE EXCEPTION 'fees: stationery % cannot go from % to % (new holder: %)', OLD.item_key, OLD.status, NEW.status, moved
            USING ERRCODE = 'check_violation', CONSTRAINT = 'stationery_transition';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- not on the scope column: an org-unit move rewrites every row's holder_org_path, and a final item must survive it
CREATE TRIGGER "stationery_transition" BEFORE INSERT OR UPDATE OF "holder_unit_id", "status", "status_on", "used_for_table",
    "used_for_id", "case_id", "end_reason", "note", "last_movement_id", "kind", "series", "serial", "batch_id", "variant",
    "valid_efy" ON "fees"."stationery_items"
    FOR EACH ROW EXECUTE FUNCTION "fees"."check_stationery_transition"();
--> statement-breakpoint
-- history is not deleted, and the ledger is not changed: SELECT and INSERT only, and an item's own life in its columns
GRANT SELECT, INSERT ON "fees"."stationery_batches", "fees"."stationery_items", "fees"."stationery_movements",
    "fees"."stationery_closings" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("holder_unit_id", "status", "status_on", "used_for_table", "used_for_id", "case_id", "end_reason", "note",
    "last_movement_id", "updated_at", "updated_by", "row_version")
    ON "fees"."stationery_items" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("card_key", "stationery_item_id", "updated_at", "updated_by", "row_version")
    ON "competency"."licence_print_batch_items" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.stationery_batches', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.stationery_items', 'registry', 'holder_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.stationery_movements', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.stationery_closings', 'transaction', 'org_path');
