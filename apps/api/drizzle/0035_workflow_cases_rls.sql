-- Cases, tasks and their timeline (task 0.19b), hand-written: scope triggers, the case number sequence, checks, the
-- append-only timeline, grants, RLS (class T: cases and events at the handling unit, tasks at the assignee unit), the
-- foreign key submissions waited for (0.16a), and two reviewed SECURITY DEFINER functions:
--   workflow.role_holders   who holds a role in a unit of the caller's chain (its ancestors and its subtree): separation
--                           of duties routes a step up the tree when nobody else in the unit may take it
--   workflow.open_task      opens the step a transition leads to in a unit above the caller's scope ("the zone approves
--                           for a town"): only for a case the caller sees, in a unit above or at its handling unit, for
--                           the role the case's current state assigns
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."cases"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."case_tasks"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."case_events"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
-- case numbers: an ordinary sequence (gaps are harmless, no contention; architecture.md §17)
CREATE SEQUENCE "workflow"."case_number_seq" AS bigint START 1;
--> statement-breakpoint
ALTER TABLE "workflow"."cases"
    ADD CONSTRAINT "cases_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "cases_state_check" CHECK ("state" ~ '^[a-z][a-z0-9_]{0,62}$'),
    ADD CONSTRAINT "cases_config_check" CHECK (jsonb_typeof("config") = 'object' AND pg_column_size("config") <= 65536),
    ADD CONSTRAINT "cases_config_hash_check" CHECK ("config_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "cases_facts_check" CHECK (jsonb_typeof("facts") = 'object' AND pg_column_size("facts") <= 262144);
--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks"
    ADD CONSTRAINT "case_tasks_status_check" CHECK ("status" IN ('open', 'done', 'cancelled')),
    ADD CONSTRAINT "case_tasks_closed_check" CHECK (("status" = 'open') = ("closed_at" IS NULL)),
    ADD CONSTRAINT "case_tasks_state_check" CHECK ("state_key" ~ '^[a-z][a-z0-9_]{0,62}$');
--> statement-breakpoint
ALTER TABLE "workflow"."case_events"
    ADD CONSTRAINT "case_events_kind_check" CHECK ("kind" IN ('started', 'transition', 'routed')),
    -- a person or a system actor, never both
    ADD CONSTRAINT "case_events_actor_check" CHECK (
        "actor_user_id" IS NULL OR "system_actor" IS NULL),
    ADD CONSTRAINT "case_events_system_actor_check" CHECK (
        coalesce("system_actor" ~ '^system:[a-z][a-z0-9-]{0,62}$', true)),
    ADD CONSTRAINT "case_events_comment_check" CHECK (coalesce(length("comment"), 1) BETWEEN 1 AND 2000),
    ADD CONSTRAINT "case_events_data_check" CHECK (
        "data" IS NULL OR (jsonb_typeof("data") = 'object' AND pg_column_size("data") <= 65536));
--> statement-breakpoint
-- answers filled in on a case's step belong to that case
ALTER TABLE "forms"."submissions"
    ADD CONSTRAINT "submissions_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
-- A case's timeline never changes and is never removed, for any role, the owner included: only a unit move may rewrite
-- its org_path (kernel.org_units_move_subtree, through the set_org_path trigger).
CREATE FUNCTION "workflow"."case_events_append_only"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'workflow.case_events is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "case_events_append_only" BEFORE UPDATE OR DELETE ON "workflow"."case_events"
    FOR EACH ROW EXECUTE FUNCTION "workflow"."case_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "case_events_no_truncate" BEFORE TRUNCATE ON "workflow"."case_events"
    FOR EACH STATEMENT EXECUTE FUNCTION "workflow"."case_events_append_only"();
--> statement-breakpoint
CREATE FUNCTION "workflow"."role_holders"(p_unit uuid, p_role text)
    RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT ra.user_id
      FROM kernel.role_assignments ra
      JOIN kernel.org_units u ON u.id = ra.unit_id
      JOIN kernel.users us ON us.id = ra.user_id
     WHERE ra.unit_id = p_unit
       AND ra.role_key = p_role
       AND ra.valid_from <= now()
       AND (ra.valid_to IS NULL OR ra.valid_to > now())
       AND us.active
       AND u.region_id = nullif(current_setting('app.region_id', true), '')::uuid
       AND (u.path @> nullif(current_setting('app.scope_path', true), '')::ltree
            OR u.path <@ nullif(current_setting('app.scope_path', true), '')::ltree)
     LIMIT 500
$$;
--> statement-breakpoint
CREATE FUNCTION "workflow"."open_task"(
    p_id uuid, p_case uuid, p_state text, p_unit uuid, p_role text, p_routed_from uuid
)
    RETURNS void
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_region uuid := nullif(current_setting('app.region_id', true), '')::uuid;
    v_scope ltree := nullif(current_setting('app.scope_path', true), '')::ltree;
    v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
    v_path ltree;
BEGIN
    -- a case the caller sees, open, in the state the task is for, whose workflow assigns that state to this role
    SELECT c.org_path INTO v_path
      FROM workflow.cases c
      JOIN workflow.workflow_definition_versions v ON v.id = c.definition_version_id
     WHERE c.id = p_case
       AND c.region_id = v_region
       AND c.org_path <@ v_scope
       AND c.closed_at IS NULL
       AND c.state = p_state
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition -> 'states') s
                    WHERE s ->> 'key' = p_state AND s ->> 'kind' = 'task' AND s -> 'assignee' ->> 'role' = p_role);
    IF v_path IS NULL OR v_user IS NULL THEN
        RAISE EXCEPTION 'workflow.open_task: the case is not one the caller may advance' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- the unit (and the one it was routed from) is the handling unit or above it
    IF NOT EXISTS (SELECT 1 FROM kernel.org_units u
                    WHERE u.id = p_unit AND u.region_id = v_region AND u.path @> v_path)
       OR (p_routed_from IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM kernel.org_units u
             WHERE u.id = p_routed_from AND u.region_id = v_region AND u.path @> v_path)) THEN
        RAISE EXCEPTION 'workflow.open_task: the unit is not above the case' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO workflow.case_tasks (id, region_id, case_id, unit_id, state_key, role, status, routed_from_unit_id,
                                     created_by, updated_by)
    VALUES (p_id, v_region, p_case, p_unit, p_state, p_role, 'open', p_routed_from, v_user, v_user);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "workflow"."role_holders"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "workflow"."role_holders"(uuid, text) TO itrms_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "workflow"."open_task"(uuid, uuid, text, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "workflow"."open_task"(uuid, uuid, text, uuid, text, uuid) TO itrms_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "workflow"."case_number_seq" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "workflow"."cases", "workflow"."case_tasks", "workflow"."case_events" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "facts", "closed_at", "updated_at", "updated_by", "row_version")
    ON "workflow"."cases" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "acted_by", "action", "closed_at", "updated_at", "updated_by", "row_version")
    ON "workflow"."case_tasks" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.cases', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.case_tasks', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.case_events', 'transaction', 'org_path');
