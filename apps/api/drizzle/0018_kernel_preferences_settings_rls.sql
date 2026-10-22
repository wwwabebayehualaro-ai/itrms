-- The region's settings (class C on the region's path) and each person's own preferences (task 0.13), hand-written.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."settings_values"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
ALTER TABLE "kernel"."settings_values"
    ADD CONSTRAINT "settings_values_key_check" CHECK ("key" ~ '^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*$'),
    ADD CONSTRAINT "settings_values_size_check" CHECK (pg_column_size("value") <= 16384);
--> statement-breakpoint
GRANT SELECT, INSERT ON "kernel"."settings_values" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("value", "updated_at", "updated_by", "row_version") ON "kernel"."settings_values" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.settings_values', 'config', 'org_path');
--> statement-breakpoint
ALTER TABLE "kernel"."users"
    ADD CONSTRAINT "users_preferences_check"
    CHECK (jsonb_typeof("preferences") = 'object' AND pg_column_size("preferences") <= 16384);
--> statement-breakpoint
-- A person's own preferences, whatever unit they act for: the users row is the home unit's (class R), which another
-- unit's scope does not reach, so this definer function changes exactly the caller's row, by the request's user id. The
-- keys sent replace theirs and the others stay (a page visit in one tab never drops a favourite pinned in another). It
-- answers the preferences as they were, for the audit row; null when the caller has no active account.
CREATE FUNCTION "kernel"."set_my_preferences"(p_changes jsonb) RETURNS jsonb
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    WITH me AS (
        SELECT u.id, u.preferences FROM kernel.users u
         WHERE u.id = nullif(current_setting('app.user_id', true), '')::uuid AND u.active
           AND jsonb_typeof(p_changes) = 'object'
           FOR UPDATE
    ), changed AS (
        UPDATE kernel.users u
           SET preferences = me.preferences || p_changes,
               updated_at = now(),
               updated_by = me.id,
               row_version = u.row_version + 1
          FROM me
         WHERE u.id = me.id
        RETURNING me.preferences AS before
    )
    SELECT before FROM changed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."set_my_preferences"(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."set_my_preferences"(jsonb) TO itrms_app;
