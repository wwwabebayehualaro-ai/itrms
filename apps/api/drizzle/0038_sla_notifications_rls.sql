-- SLA calendars, due times and notifications (task 0.20a), hand-written: scope triggers, checks, grants, RLS, the task
-- opened above the caller's scope now carries its due time, and two reviewed SECURITY DEFINER functions for a person's
-- own notifications (the API holds no grant on the table):
--   kernel.my_notifications        the caller's own, newest first, a page at a time
--   kernel.read_my_notifications   marks the caller's own as read
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."working_calendars"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "workflow"."holidays"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."notifications"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "workflow"."working_calendars"
    ADD CONSTRAINT "working_calendars_week_check" CHECK (
        jsonb_typeof("week") = 'object' AND pg_column_size("week") <= 4096),
    ADD CONSTRAINT "working_calendars_half_days_check" CHECK (
        jsonb_typeof("half_days") = 'object' AND pg_column_size("half_days") <= 16384);
--> statement-breakpoint
ALTER TABLE "workflow"."holidays"
    ADD CONSTRAINT "holidays_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,62}$'),
    ADD CONSTRAINT "holidays_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 2048);
--> statement-breakpoint
ALTER TABLE "kernel"."notifications"
    ADD CONSTRAINT "notifications_key_check" CHECK ("message_key" ~ '^[a-z][a-z0-9-]*(\.[a-zA-Z0-9_-]+){1,6}$'),
    ADD CONSTRAINT "notifications_params_check" CHECK (
        jsonb_typeof("params") = 'object' AND pg_column_size("params") <= 4096),
    ADD CONSTRAINT "notifications_link_check" CHECK (
        "link" IS NULL OR (jsonb_typeof("link") = 'object' AND pg_column_size("link") <= 1024));
--> statement-breakpoint
-- a task's due time and overdue mark, set by the engine and the SLA timers
GRANT UPDATE ("due_at", "overdue_at") ON "workflow"."case_tasks" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("due_at") ON "workflow"."cases" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "workflow"."working_calendars", "workflow"."holidays" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("week", "half_days", "updated_at", "updated_by", "row_version") ON "workflow"."working_calendars" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.working_calendars', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('workflow.holidays', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.notifications', 'transaction', 'org_path');
--> statement-breakpoint
-- a unit move (kernel.org_units_move_subtree, run by the API that moves it) rewrites every scope column below the unit:
-- it reads the scope columns, nothing else (the API reads a message only through kernel.my_notifications)
GRANT SELECT ("region_id", "org_path") ON "kernel"."notifications" TO itrms_app;
--> statement-breakpoint
-- open_task with the task's due time (its SLA on the assignee unit's calendar, computed by the engine)
DROP FUNCTION "workflow"."open_task"(uuid, uuid, text, uuid, text, uuid);
--> statement-breakpoint
CREATE FUNCTION "workflow"."open_task"(
    p_id uuid, p_case uuid, p_state text, p_unit uuid, p_role text, p_routed_from uuid, p_due timestamptz
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
    INSERT INTO workflow.case_tasks (id, region_id, case_id, unit_id, state_key, role, status, routed_from_unit_id, due_at,
                                     created_by, updated_by)
    VALUES (p_id, v_region, p_case, p_unit, p_state, p_role, 'open', p_routed_from, p_due, v_user, v_user);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "workflow"."open_task"(uuid, uuid, text, uuid, text, uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "workflow"."open_task"(uuid, uuid, text, uuid, text, uuid, timestamptz) TO itrms_app;
--> statement-breakpoint
CREATE FUNCTION "kernel"."my_notifications"(p_limit integer, p_before timestamptz)
    RETURNS TABLE (id uuid, unit_id uuid, message_key text, params jsonb, link jsonb, read_at timestamptz,
                   created_at timestamptz)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT n.id, n.unit_id, n.message_key, n.params, n.link, n.read_at, n.created_at
      FROM kernel.notifications n
     WHERE n.user_id = nullif(current_setting('app.user_id', true), '')::uuid
       AND n.region_id = nullif(current_setting('app.region_id', true), '')::uuid
       AND (p_before IS NULL OR n.created_at < p_before)
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
--> statement-breakpoint
CREATE FUNCTION "kernel"."read_my_notifications"(p_ids uuid[])
    RETURNS integer
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    WITH marked AS (
        UPDATE kernel.notifications n
           SET read_at = now(), updated_at = now(), row_version = n.row_version + 1
         WHERE n.id = ANY (p_ids[1:200])
           AND n.user_id = nullif(current_setting('app.user_id', true), '')::uuid
           AND n.region_id = nullif(current_setting('app.region_id', true), '')::uuid
           AND n.read_at IS NULL
        RETURNING 1
    )
    SELECT count(*)::integer FROM marked
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."my_notifications"(integer, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."my_notifications"(integer, timestamptz) TO itrms_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."read_my_notifications"(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."read_my_notifications"(uuid[]) TO itrms_app;
