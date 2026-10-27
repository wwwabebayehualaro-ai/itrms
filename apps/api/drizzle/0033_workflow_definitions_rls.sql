-- Workflow definitions (task 0.19a), hand-written: scope triggers, checks, the key that ties a version to its definition,
-- grants, RLS, and the immutability of versions. Class C (the owner unit's subtree writes; it and its ancestors' subtrees
-- read, so a woreda's cases run on the bureau's workflows).
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."workflow_definitions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."workflow_definition_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
-- the size limit is the API's (MAX_DEFINITION_BYTES) with room for jsonb's own encoding
ALTER TABLE "workflow"."workflow_definitions"
    ADD CONSTRAINT "workflow_definitions_key_check" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("key") BETWEEN 2 AND 80),
    ADD CONSTRAINT "workflow_definitions_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 4096);
--> statement-breakpoint
ALTER TABLE "workflow"."workflow_definition_versions"
    ADD CONSTRAINT "workflow_definition_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "workflow_definition_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "workflow_definition_versions_definition_check" CHECK (
        jsonb_typeof("definition") = 'object' AND pg_column_size("definition") <= 1048576),
    -- the target of the key below: a version is named together with its definition
    ADD CONSTRAINT "workflow_definition_versions_definition_uq" UNIQUE ("id", "definition_id");
--> statement-breakpoint
-- a definition's latest version is one of its own
ALTER TABLE "workflow"."workflow_definitions"
    ADD CONSTRAINT "workflow_definitions_latest_version_fk" FOREIGN KEY ("latest_version_id", "id")
        REFERENCES "workflow"."workflow_definition_versions" ("id", "definition_id");
--> statement-breakpoint
-- A version never changes and is never removed, for any role, the owner included: only a unit move may rewrite its
-- org_path (kernel.org_units_move_subtree, through the set_org_path trigger).
CREATE FUNCTION "workflow"."workflow_definition_versions_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'workflow.workflow_definition_versions is immutable: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workflow_definition_versions_immutable" BEFORE UPDATE OR DELETE ON "workflow"."workflow_definition_versions"
    FOR EACH ROW EXECUTE FUNCTION "workflow"."workflow_definition_versions_immutable"();
--> statement-breakpoint
CREATE TRIGGER "workflow_definition_versions_no_truncate" BEFORE TRUNCATE ON "workflow"."workflow_definition_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "workflow"."workflow_definition_versions_immutable"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "workflow" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "workflow"."workflow_definitions", "workflow"."workflow_definition_versions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "active", "latest_version_id", "updated_at", "updated_by", "row_version")
    ON "workflow"."workflow_definitions" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.workflow_definitions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.workflow_definition_versions', 'config', 'org_path');
