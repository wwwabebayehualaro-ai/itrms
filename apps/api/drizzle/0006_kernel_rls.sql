-- Row-level security (ADR-0011, ADR-0031; architecture.md §5), hand-written: drizzle-kit writes no policies.
-- * kernel.apply_rls(table, class, column) gives a table its class's policies, always TO itrms_app, always checking
--   region_id, reading the request's settings null-safely (`nullif(…, '')`: a pooled connection that served a request
--   reads '' afterwards, which must match nothing) once per query (an initplan). There is no bypass setting: work that
--   must see across scopes runs as itrms_system (BYPASSRLS) in the worker. The owner is not subject to RLS (no FORCE), so
--   migrations and the installer's seeds see every row.
-- * kernel.set_org_path() keeps a row's scope column from the unit (or the region) it belongs to, on every insert and
--   update: written values are replaced, so a client can never place a row in another scope.
-- * When a unit moves, the org_units trigger also rewrites the scope column of every row below it in the declared tables
--   (kernel.rls_tables), except the audit log, which keeps the path at the time of the act.

CREATE TABLE "kernel"."rls_tables" (
    "table_name" regclass PRIMARY KEY,
    "class" text NOT NULL CHECK ("class" IN ('registry', 'transaction', 'config', 'party')),
    "column_name" text NOT NULL
);
--> statement-breakpoint
GRANT SELECT ON "kernel"."rls_tables" TO itrms_app;
--> statement-breakpoint
CREATE FUNCTION "kernel"."apply_rls"(tbl regclass, cls text, col text) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    region constant text := '(region_id = (SELECT nullif(current_setting(''app.region_id'', true), '''')::uuid))';
    scope constant text := '(SELECT nullif(current_setting(''app.scope_path'', true), '''')::ltree)';
    party constant text := '(SELECT nullif(current_setting(''app.party_id'', true), '''')::uuid)';
    inside text;
    old record;
BEGIN
    IF cls NOT IN ('registry', 'transaction', 'config', 'party') THEN
        RAISE EXCEPTION 'apply_rls: unknown class %', cls;
    END IF;
    FOR old IN SELECT polname FROM pg_policy WHERE polrelid = tbl LOOP
        EXECUTE format('DROP POLICY %I ON %s', old.polname, tbl);
    END LOOP;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
    inside := format('(%I <@ %s)', col, scope);

    IF cls = 'transaction' THEN
        EXECUTE format('CREATE POLICY rls_transaction ON %s FOR ALL TO itrms_app USING (%s AND %s) WITH CHECK (%s AND %s)',
            tbl, region, inside, region, inside);
    ELSIF cls = 'config' THEN
        EXECUTE format('CREATE POLICY rls_config_read ON %s FOR SELECT TO itrms_app USING (%s AND (%s OR %I @> %s))',
            tbl, region, inside, col, scope);
        EXECUTE format('CREATE POLICY rls_config_insert ON %s FOR INSERT TO itrms_app WITH CHECK (%s AND %s)',
            tbl, region, inside);
        EXECUTE format('CREATE POLICY rls_config_update ON %s FOR UPDATE TO itrms_app USING (%s AND %s) WITH CHECK (%s AND %s)',
            tbl, region, inside, region, inside);
        EXECUTE format('CREATE POLICY rls_config_delete ON %s FOR DELETE TO itrms_app USING (%s AND %s)',
            tbl, region, inside);
    ELSIF cls = 'registry' THEN
        EXECUTE format('CREATE POLICY rls_registry_read ON %s FOR SELECT TO itrms_app USING (%s)', tbl, region);
        EXECUTE format('CREATE POLICY rls_registry_insert ON %s FOR INSERT TO itrms_app WITH CHECK (%s AND %s)',
            tbl, region, inside);
        EXECUTE format('CREATE POLICY rls_registry_update ON %s FOR UPDATE TO itrms_app USING (%s AND %s) WITH CHECK (%s AND %s)',
            tbl, region, inside, region, inside);
        EXECUTE format('CREATE POLICY rls_registry_delete ON %s FOR DELETE TO itrms_app USING (%s AND %s)',
            tbl, region, inside);
    ELSE
        EXECUTE format('CREATE POLICY rls_party ON %s FOR ALL TO itrms_app USING (%s AND %I = %s) WITH CHECK (%s AND %I = %s)',
            tbl, region, col, party, region, col, party);
    END IF;

    -- a move run by the API rewrites the scope column of the rows below the unit; the table's set_org_path trigger
    -- decides the value (a written one is replaced), so the API may be granted the column only when that trigger exists.
    -- The audit log keeps the path at the time of the act; org_units keeps its own path (drizzle/0004).
    IF cls <> 'party' AND tbl NOT IN ('kernel.audit_log'::regclass, 'kernel.org_units'::regclass) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger tg
             WHERE tg.tgrelid = tbl AND NOT tg.tgisinternal AND tg.tgfoid = 'kernel.set_org_path()'::regprocedure
        ) THEN
            RAISE EXCEPTION 'apply_rls: % needs a kernel.set_org_path trigger to keep %', tbl, col;
        END IF;
        EXECUTE format('GRANT UPDATE (%I) ON %s TO itrms_app', col, tbl);
    END IF;

    INSERT INTO kernel.rls_tables (table_name, class, column_name) VALUES (tbl, cls, col)
        ON CONFLICT (table_name) DO UPDATE SET class = EXCLUDED.class, column_name = EXCLUDED.column_name;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."apply_rls"(regclass, text, text) FROM PUBLIC;
--> statement-breakpoint
-- TG_ARGV[0]: where the scope comes from ('region_id': the region's root; any other column: that unit's path);
-- TG_ARGV[1]: the scope column (default org_path)
CREATE FUNCTION "kernel"."set_org_path"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    source uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    target text := coalesce(TG_ARGV[1], 'org_path');
    scope ltree;
    unit_region uuid;
BEGIN
    -- a misspelt column would otherwise be ignored and the client's value kept
    IF NOT (to_jsonb(NEW) ? target AND to_jsonb(NEW) ? TG_ARGV[0]) THEN
        RAISE EXCEPTION 'set_org_path on %.%: no column % or %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0], target;
    END IF;
    IF TG_ARGV[0] = 'region_id' THEN
        scope := kernel.org_unit_label(source);
    ELSE
        SELECT u.path, u.region_id INTO scope, unit_region FROM kernel.org_units u WHERE u.id = source;
        -- not found, or not visible to the person: the same answer (no detail that would confirm an id exists)
        IF scope IS NULL THEN
            RAISE EXCEPTION '%.%: unit not found', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF unit_region IS DISTINCT FROM (to_jsonb(NEW) ->> 'region_id')::uuid THEN
            RAISE EXCEPTION '%.%: the row''s region is not its unit''s', TG_TABLE_SCHEMA, TG_TABLE_NAME
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object(target, scope::text));
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."org_level_definitions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."unit_types"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."unit_type_services"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."unit_type_roles"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."org_departments"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('org_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."unit_service_overrides"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('org_unit_id');
--> statement-breakpoint
-- rows written before this migration
UPDATE "kernel"."org_level_definitions" SET "org_path" = "org_path";
--> statement-breakpoint
UPDATE "kernel"."unit_types" SET "org_path" = "org_path";
--> statement-breakpoint
UPDATE "kernel"."unit_type_services" SET "org_path" = "org_path";
--> statement-breakpoint
UPDATE "kernel"."unit_type_roles" SET "org_path" = "org_path";
--> statement-breakpoint
UPDATE "kernel"."org_departments" SET "org_path" = "org_path";
--> statement-breakpoint
UPDATE "kernel"."unit_service_overrides" SET "org_path" = "org_path";
--> statement-breakpoint
-- a move rewrites the subtree's paths, then the scope column of the rows below it (the set_org_path triggers recompute it)
CREATE OR REPLACE FUNCTION "kernel"."org_units_move_subtree"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    t record;
BEGIN
    UPDATE kernel.org_units
       SET path = NEW.path || subpath(path, nlevel(OLD.path))
     WHERE path <@ OLD.path AND id <> NEW.id;
    FOR t IN
        SELECT table_name, column_name FROM kernel.rls_tables
         WHERE class <> 'party'
           AND table_name NOT IN ('kernel.org_units'::regclass, 'kernel.audit_log'::regclass)
    LOOP
        EXECUTE format('UPDATE %s SET %I = %I WHERE %I <@ $1', t.table_name, t.column_name, t.column_name, t.column_name)
            USING OLD.path;
    END LOOP;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.org_units', 'config', 'path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.org_level_definitions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.unit_types', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.unit_type_services', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.unit_type_roles', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.org_departments', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.unit_service_overrides', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.audit_log', 'transaction', 'org_path');
--> statement-breakpoint
-- A sensitive event before a unit is known (a refused sign-in, a request without an active unit): the audit log is class T,
-- so the API cannot write a row without a scope. This narrow function, owned by the owner (not subject to RLS), writes one
-- such event and nothing else (architecture §15, SEC-LG-1).
CREATE FUNCTION "kernel"."record_context_free_event"(event_type text, data jsonb, actor_id uuid, request_id text, ip text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
AS $$
BEGIN
    IF event_type !~ '^(access|auth).[a-z_.]{1,60}$' THEN
        RAISE EXCEPTION 'record_context_free_event: % is not an access or auth event', event_type;
    END IF;
    INSERT INTO kernel.audit_log (id, action, event_type, diff, actor_id, request_id, ip)
    VALUES (gen_random_uuid(), 'event', event_type, data, actor_id, left(request_id, 64), left(ip, 64));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."record_context_free_event"(text, jsonb, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."record_context_free_event"(text, jsonb, uuid, text, text) TO itrms_app;
