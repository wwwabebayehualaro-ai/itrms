-- Saved views of form data (task 0.16d), hand-written: the scope trigger, checks, grants and RLS (class T at the unit:
-- its subtree sees the shared views). That a private view is its owner's alone is checked on created_by by the API.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."saved_views"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "forms"."saved_views"
    ADD CONSTRAINT "saved_views_visibility_check" CHECK ("visibility" IN ('private', 'unit')),
    ADD CONSTRAINT "saved_views_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
    -- the unit's default is a shared view
    ADD CONSTRAINT "saved_views_default_check" CHECK (NOT "is_default" OR "visibility" = 'unit'),
    ADD CONSTRAINT "saved_views_config_check" CHECK (jsonb_typeof("config") = 'object' AND pg_column_size("config") <= 65536);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "forms"."saved_views" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "visibility", "is_default", "config", "updated_at", "updated_by", "row_version")
    ON "forms"."saved_views" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.saved_views', 'transaction', 'org_path');
