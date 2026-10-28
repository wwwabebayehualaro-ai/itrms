-- The inbox and comments (task 0.20b), hand-written: claiming a step, comments on the timeline, and one reviewed
-- SECURITY DEFINER function:
--   workflow.case_people   the people who work on a case the caller sees (an active role in its handling unit or an
--                          office above it): whom a comment may mention, by name or by id; ids and display names only
ALTER TABLE "workflow"."case_tasks"
    ADD CONSTRAINT "case_tasks_claimed_check" CHECK (("claimed_by" IS NULL) = ("claimed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "workflow"."case_events" DROP CONSTRAINT "case_events_kind_check";
--> statement-breakpoint
ALTER TABLE "workflow"."case_events"
    ADD CONSTRAINT "case_events_kind_check" CHECK ("kind" IN ('started', 'transition', 'routed', 'comment')),
    -- a comment is a person's, and says something
    ADD CONSTRAINT "case_events_comment_kind_check" CHECK (
        "kind" <> 'comment' OR ("actor_user_id" IS NOT NULL AND "comment" IS NOT NULL));
--> statement-breakpoint
GRANT UPDATE ("claimed_by", "claimed_at") ON "workflow"."case_tasks" TO itrms_app;
--> statement-breakpoint
CREATE FUNCTION "workflow"."case_people"(p_case uuid, p_q text, p_ids uuid[])
    RETURNS TABLE (user_id uuid, display_name text)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT DISTINCT us.id, us.display_name
      FROM workflow.cases c
      JOIN kernel.org_units u ON u.path @> c.org_path AND u.region_id = c.region_id
      JOIN kernel.role_assignments ra ON ra.unit_id = u.id
      JOIN kernel.users us ON us.id = ra.user_id
     WHERE c.id = p_case
       -- a case the caller sees
       AND c.region_id = nullif(current_setting('app.region_id', true), '')::uuid
       AND c.org_path <@ nullif(current_setting('app.scope_path', true), '')::ltree
       AND ra.valid_from <= now()
       AND (ra.valid_to IS NULL OR ra.valid_to > now())
       AND us.active
       -- an office (or one above it) switched off has nobody who works there (as workflow.role_holders)
       AND NOT EXISTS (SELECT 1 FROM kernel.org_units a WHERE a.path @> u.path AND NOT a.active)
       AND (p_q IS NULL OR us.display_name ILIKE '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_ids IS NULL OR us.id = ANY (p_ids))
     ORDER BY us.display_name
     LIMIT 50
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "workflow"."case_people"(uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "workflow"."case_people"(uuid, text, uuid[]) TO itrms_app;
