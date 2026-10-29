-- The service catalogue (task 0.21b), hand-written: scope triggers, checks, the keys to the forms' and workflows' versions
-- (those slices' tables), the immutability of versions, grants and RLS. Class C: the catalogue and its versions belong to
-- the region's root (every unit reads them, a seat at the root writes them); an override to its unit (the units above
-- read it, the subtree writes it).
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "services"."service_definitions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "services"."service_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "services"."service_overrides"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "services"."service_definitions"
    ADD CONSTRAINT "service_definitions_code_check" CHECK ("code" ~ '^[A-Z]{2,5}-[0-9]{2}$'),
    ADD CONSTRAINT "service_definitions_process_check" CHECK ("process" BETWEEN 1 AND 10),
    ADD CONSTRAINT "service_definitions_module_check" CHECK ("module" ~ '^[a-z][a-z0-9-]*$'),
    ADD CONSTRAINT "service_definitions_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 4096);
--> statement-breakpoint
ALTER TABLE "services"."service_versions"
    ADD CONSTRAINT "service_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "service_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "service_versions_defaults_check" CHECK (
        jsonb_typeof("defaults") = 'object' AND pg_column_size("defaults") <= 262144),
    ADD CONSTRAINT "service_versions_policy_check" CHECK (
        jsonb_typeof("override_policy") = 'object' AND pg_column_size("override_policy") <= 16384),
    ADD CONSTRAINT "service_versions_templates_check" CHECK (jsonb_typeof("template_version_ids") = 'array'),
    ADD CONSTRAINT "service_versions_form_version_fk" FOREIGN KEY ("form_version_id")
        REFERENCES "forms"."form_versions" ("id"),
    ADD CONSTRAINT "service_versions_workflow_version_fk" FOREIGN KEY ("workflow_version_id")
        REFERENCES "workflow"."workflow_definition_versions" ("id"),
    -- the target of the key below: a version is named together with its service
    ADD CONSTRAINT "service_versions_service_uq" UNIQUE ("id", "service_id");
--> statement-breakpoint
-- a service's current version is one of its own
ALTER TABLE "services"."service_definitions"
    ADD CONSTRAINT "service_definitions_current_version_own_fk" FOREIGN KEY ("current_version_id", "id")
        REFERENCES "services"."service_versions" ("id", "service_id");
--> statement-breakpoint
ALTER TABLE "services"."service_overrides"
    ADD CONSTRAINT "service_overrides_values_check" CHECK (
        jsonb_typeof("values") = 'object' AND pg_column_size("values") <= 65536),
    ADD CONSTRAINT "service_overrides_reason_check" CHECK (length("reason") BETWEEN 3 AND 500);
--> statement-breakpoint
-- A version never changes and is never removed, for any role, the owner included: only a unit move may rewrite its
-- org_path (kernel.org_units_move_subtree, through the set_org_path trigger).
CREATE FUNCTION "services"."service_versions_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'services.service_versions is immutable: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_versions_immutable" BEFORE UPDATE OR DELETE ON "services"."service_versions"
    FOR EACH ROW EXECUTE FUNCTION "services"."service_versions_immutable"();
--> statement-breakpoint
CREATE TRIGGER "service_versions_no_truncate" BEFORE TRUNCATE ON "services"."service_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "services"."service_versions_immutable"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "services" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "services"."service_definitions", "services"."service_versions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("process", "module", "name", "active", "current_version_id", "updated_at", "updated_by", "row_version")
    ON "services"."service_definitions" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "services"."service_overrides" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("values", "reason", "updated_at", "updated_by", "row_version") ON "services"."service_overrides" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('services.service_definitions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('services.service_versions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('services.service_overrides', 'config', 'org_path');
