-- The org tree's invariants (ADR-0011, architecture.md §5), hand-written: drizzle-kit has no triggers, checks or grants.
-- * `path` is the materialised ancestry, one label per unit (`u` + the id's hex): set from the parent on insert, rewritten
--   for the whole subtree when a unit moves, refused when written directly.
-- * A root unit is a region and its own region; every other unit stays in its parent's region, and never moves under
--   itself. Only a root is of kind region.
-- * Tree writes of a region are serialised (a transaction-level advisory lock taken by the trigger), so two moves cannot
--   make a cycle, a unit is never created under a parent that is moving or being deactivated, and the checks below read
--   committed state.
-- * A unit is created only under an active parent, and deactivated only when no active unit is below it.
-- * No other trigger may write org_units: the direct-path-write refusal trusts a nested trigger to be the subtree rewrite.
-- The level rules (a unit's level ranks below its parent's; the unit type fits the level) are checked by the org service
-- and the import, where the error can name the field.

ALTER TABLE "kernel"."org_units"
    ADD CONSTRAINT "org_units_kind_check" CHECK ("kind" IN
        ('region', 'zone', 'woreda', 'special_woreda', 'town_admin', 'city_admin', 'sub_city', 'kebele'));
--> statement-breakpoint
ALTER TABLE "kernel"."org_units"
    ADD CONSTRAINT "org_units_root_is_region_check" CHECK (("parent_id" IS NULL) = ("region_id" = "id"));
--> statement-breakpoint
ALTER TABLE "kernel"."org_units"
    ADD CONSTRAINT "org_units_region_kind_check" CHECK (("kind" = 'region') = ("parent_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "kernel"."org_units"
    ADD CONSTRAINT "org_units_code_check" CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$');
--> statement-breakpoint
ALTER TABLE "kernel"."org_level_definitions" ADD CONSTRAINT "org_level_definitions_rank_check" CHECK ("rank" >= 1);
--> statement-breakpoint
ALTER TABLE "kernel"."unit_type_services"
    ADD CONSTRAINT "unit_type_services_code_check" CHECK ("service_code" ~ '^[A-Z]{2,3}-[0-9]{2}$');
--> statement-breakpoint
ALTER TABLE "kernel"."unit_service_overrides"
    ADD CONSTRAINT "unit_service_overrides_code_check" CHECK ("service_code" ~ '^[A-Z]{2,3}-[0-9]{2}$');
--> statement-breakpoint
ALTER TABLE "kernel"."unit_service_overrides"
    ADD CONSTRAINT "unit_service_overrides_reason_check" CHECK (length(btrim("reason")) > 0);
--> statement-breakpoint
CREATE FUNCTION "kernel"."org_unit_label"(id uuid) RETURNS ltree
    LANGUAGE sql IMMUTABLE
    SET search_path = pg_catalog, public
AS $$ SELECT text2ltree('u' || replace(id::text, '-', '')) $$;
--> statement-breakpoint
CREATE FUNCTION "kernel"."org_units_set_path"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    parent record;
BEGIN
    -- one tree writer per region at a time (released at commit); nested subtree rewrites already hold it
    PERFORM pg_advisory_xact_lock(hashtextextended('kernel.org_units:' || NEW.region_id::text, 0));

    IF TG_OP = 'UPDATE' THEN
        IF OLD.active AND NOT NEW.active AND EXISTS (
            SELECT 1 FROM kernel.org_units c WHERE c.parent_id = NEW.id AND c.active
        ) THEN
            RAISE EXCEPTION 'org_units: deactivate the units below it first' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.region_id <> OLD.region_id THEN
            RAISE EXCEPTION 'org_units: a unit never changes region' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
            -- only the subtree rewrite below (a nested trigger) may change a path without a move
            IF NEW.path IS DISTINCT FROM OLD.path AND pg_trigger_depth() < 2 THEN
                RAISE EXCEPTION 'org_units: path is kept by the tree; change parent_id to move a unit'
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    IF NEW.parent_id IS NULL THEN
        NEW.path := kernel.org_unit_label(NEW.id);
        RETURN NEW;
    END IF;

    SELECT u.path, u.region_id, u.active INTO parent FROM kernel.org_units u WHERE u.id = NEW.parent_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'org_units: parent % does not exist', NEW.parent_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF parent.region_id <> NEW.region_id THEN
        RAISE EXCEPTION 'org_units: a unit stays in its parent''s region' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT parent.active THEN
        RAISE EXCEPTION 'org_units: the parent unit is deactivated' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND parent.path <@ OLD.path THEN
        RAISE EXCEPTION 'org_units: a unit cannot move under itself' USING ERRCODE = 'check_violation';
    END IF;
    NEW.path := parent.path || kernel.org_unit_label(NEW.id);
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "org_units_set_path"
    BEFORE INSERT OR UPDATE ON "kernel"."org_units"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."org_units_set_path"();
--> statement-breakpoint
CREATE FUNCTION "kernel"."org_units_move_subtree"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE kernel.org_units
       SET path = NEW.path || subpath(path, nlevel(OLD.path))
     WHERE path <@ OLD.path AND id <> NEW.id;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "org_units_move_subtree"
    AFTER UPDATE OF "parent_id" ON "kernel"."org_units"
    FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path)
    EXECUTE FUNCTION "kernel"."org_units_move_subtree"();
--> statement-breakpoint
-- the API reads and writes the tree; units are deactivated, never deleted; type defaults and overrides can be removed.
-- A unit's id, region, level, kind and type, and a level's rank, are not the API's to change (the rules on them live
-- in the service), so UPDATE is granted column by column.
GRANT SELECT, INSERT ON "kernel"."org_level_definitions", "kernel"."org_units", "kernel"."org_departments",
    "kernel"."unit_types", "kernel"."unit_type_services", "kernel"."unit_type_roles", "kernel"."unit_service_overrides"
    TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "parent_id", "path", "category", "to_confirm", "keycloak_group_id", "active", "updated_at",
    "updated_by", "row_version") ON "kernel"."org_units" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "updated_at", "updated_by", "row_version") ON "kernel"."org_level_definitions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "active", "updated_at", "updated_by", "row_version") ON "kernel"."org_departments" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "categories", "capabilities", "departments", "active", "updated_at", "updated_by", "row_version")
    ON "kernel"."unit_types" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("enabled", "updated_at", "updated_by", "row_version") ON "kernel"."unit_type_services" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("enabled", "reason", "updated_at", "updated_by", "row_version") ON "kernel"."unit_service_overrides"
    TO itrms_app;
--> statement-breakpoint
GRANT DELETE ON "kernel"."unit_type_services", "kernel"."unit_type_roles", "kernel"."unit_service_overrides" TO itrms_app;
