-- Users and role assignments (ADR-0031), hand-written: scope triggers, policies, checks, grants, and the two functions
-- that read them before any scope exists. A request does not know its scope until it knows who is calling and for which
-- unit, so the authenticator asks these SECURITY DEFINER functions (owned by the owner, which RLS does not bind). They
-- read only the caller's own user and assignments, keyed by the verified token's `sub`.

CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."users"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('home_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."role_assignments"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments"
    ADD CONSTRAINT "role_assignments_role_key_check" CHECK ("role_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$');
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments"
    ADD CONSTRAINT "role_assignments_period_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments"
    ADD CONSTRAINT "role_assignments_reason_check" CHECK (length(btrim("reason")) > 0);
--> statement-breakpoint
ALTER TABLE "kernel"."users"
    ADD CONSTRAINT "users_username_check" CHECK ("username" ~ '^[a-z0-9][a-z0-9._-]{1,63}$');
--> statement-breakpoint
GRANT SELECT, INSERT ON "kernel"."users", "kernel"."role_assignments" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("display_name", "home_unit_id", "active", "updated_at", "updated_by", "row_version") ON "kernel"."users"
    TO itrms_app;
--> statement-breakpoint
-- an assignment is ended, never changed or deleted
GRANT UPDATE ("valid_to", "updated_at", "updated_by", "row_version") ON "kernel"."role_assignments" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.users', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.role_assignments', 'transaction', 'org_path');
--> statement-breakpoint
-- The caller acting for a unit: their roles there (assignments open now, in a unit that is active with every unit above
-- it), or no row. Without a unit, the unit of their oldest open assignment.
CREATE FUNCTION "kernel"."resolve_principal"(p_sub text, p_unit uuid)
    RETURNS TABLE (user_id uuid, unit_id uuid, region_id uuid, scope_path text, roles text[])
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    WITH caller AS (
        SELECT u.id FROM kernel.users u WHERE u.keycloak_sub = p_sub AND u.active
    ), open AS (
        SELECT ra.unit_id, ra.role_key, ra.valid_from
          FROM kernel.role_assignments ra
          JOIN caller ON ra.user_id = caller.id
          JOIN kernel.org_units ou ON ou.id = ra.unit_id AND ou.active
         WHERE ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
           AND NOT EXISTS (SELECT 1 FROM kernel.org_units a WHERE a.path @> ou.path AND NOT a.active)
    ), chosen AS (
        SELECT coalesce(p_unit, (SELECT o.unit_id FROM open o ORDER BY o.valid_from, o.unit_id LIMIT 1)) AS unit_id
    )
    SELECT caller.id, ou.id, ou.region_id, ou.path::text, array_agg(DISTINCT o.role_key ORDER BY o.role_key)
      FROM caller
     CROSS JOIN chosen
      JOIN kernel.org_units ou ON ou.id = chosen.unit_id
      JOIN open o ON o.unit_id = ou.id
     GROUP BY caller.id, ou.id, ou.region_id, ou.path
$$;
--> statement-breakpoint
-- The units the caller can act for (the unit switcher), with their roles in each.
CREATE FUNCTION "kernel"."principal_units"(p_sub text)
    RETURNS TABLE (unit_id uuid, code text, name jsonb, roles text[])
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT ou.id, ou.code, ou.name, array_agg(DISTINCT ra.role_key ORDER BY ra.role_key)
      FROM kernel.users u
      JOIN kernel.role_assignments ra ON ra.user_id = u.id
      JOIN kernel.org_units ou ON ou.id = ra.unit_id AND ou.active
     WHERE u.keycloak_sub = p_sub AND u.active
       AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
       AND NOT EXISTS (SELECT 1 FROM kernel.org_units a WHERE a.path @> ou.path AND NOT a.active)
     GROUP BY ou.id, ou.code, ou.name, ou.path
     ORDER BY ou.path
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."resolve_principal"(text, uuid), "kernel"."principal_units"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."resolve_principal"(text, uuid), "kernel"."principal_units"(text) TO itrms_app;
