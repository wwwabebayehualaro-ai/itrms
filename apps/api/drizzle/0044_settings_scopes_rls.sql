-- The settings' scopes (task 0.21a), hand-written: a value's scope is now its unit's path (a unit type's value sits on
-- the region's root), so its trigger reads the unit and checks that the row's region is the unit's. Reset deletes the
-- value (audited by the API in the same transaction). Class C as before (drizzle/0018).
DROP TRIGGER "set_org_path" ON "kernel"."settings_values";
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."settings_values"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
-- rows written before this migration
UPDATE "kernel"."settings_values" SET "org_path" = "org_path";
--> statement-breakpoint
GRANT DELETE ON "kernel"."settings_values" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.settings_values', 'config', 'org_path');
