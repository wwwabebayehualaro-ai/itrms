-- The signed request context (ADR-0048; closes follow-ups 59, 62, 69). Until now the API told the database who is acting
-- with plain custom settings (app.region_id, app.scope_path, …) that the row-level-security policies and the SECURITY
-- DEFINER functions read; any SQL injection as itrms_app could set a wider scope. Now the API sends ONE setting,
-- `app.ctx`, a token signed with an HMAC key the application role cannot read (kernel.context_keys, installed by the
-- migrate process, never by a migration). kernel.ctx() verifies it; the policies and the functions read only what it
-- returns. A forged, tampered, expired or retired-key token is refused with 42501 and a `kernel.ctx:` message.
--
--   token = <mac hex>:<kid>:<json {exp,usr,reg,unit,scope,party,sub,req,ip}>, mac = HMAC-SHA256(key, kid || ':' || json)

CREATE TABLE "kernel"."context_keys" (
    "kid" text PRIMARY KEY CHECK ("kid" ~ '^[0-9a-f]{16}$'),
    "key" bytea NOT NULL CHECK (length("key") >= 32),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "retired_at" timestamptz
);
--> statement-breakpoint
-- the owner's only (the definer functions below read it): the default privileges give the system role every table
REVOKE ALL ON "kernel"."context_keys" FROM PUBLIC, itrms_app, itrms_system;
--> statement-breakpoint
CREATE TYPE "kernel"."request_context" AS (
    user_id uuid, region_id uuid, unit_id uuid, scope_path public.ltree, party_id uuid, subject text, request_id text, ip text
);
--> statement-breakpoint
-- The verified context of this transaction, or NULL when none was set (a connection that has just served a request reads
-- '' and so matches nothing). The key is looked up by id, so a key can be rotated: the old one stays valid for a grace
-- period (retired_at in the future). now() is the transaction's start: a token signed for a transaction stays good for it.
CREATE FUNCTION "kernel"."ctx"() RETURNS "kernel"."request_context"
    LANGUAGE plpgsql
    STABLE
    PARALLEL SAFE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    raw text := nullif(current_setting('app.ctx', true), '');
    v_mac text;
    v_kid text;
    v_body text;
    k bytea;
    j jsonb;
BEGIN
    IF raw IS NULL THEN
        RETURN NULL;
    END IF;
    v_mac := split_part(raw, ':', 1);
    v_kid := split_part(raw, ':', 2);
    v_body := substr(raw, length(v_mac) + length(v_kid) + 3);
    SELECT c.key INTO k FROM kernel.context_keys c
     WHERE c.kid = v_kid AND (c.retired_at IS NULL OR c.retired_at > now());
    IF k IS NULL OR v_mac <> encode(public.hmac(convert_to(v_kid || ':' || v_body, 'UTF8'), k, 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'kernel.ctx: the request context is not the API''s' USING ERRCODE = 'insufficient_privilege';
    END IF;
    j := v_body::jsonb;
    IF (j->>'exp')::bigint < extract(epoch FROM now()) THEN
        RAISE EXCEPTION 'kernel.ctx: the request context has expired' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN ROW(nullif(j->>'usr', '')::uuid, nullif(j->>'reg', '')::uuid, nullif(j->>'unit', '')::uuid,
               nullif(j->>'scope', '')::public.ltree, nullif(j->>'party', '')::uuid, nullif(j->>'sub', ''),
               left(nullif(j->>'req', ''), 64), left(nullif(j->>'ip', ''), 64))::kernel.request_context;
END;
$$;
--> statement-breakpoint
-- The API's one call per transaction: the setting is local to the transaction, and the token is checked at once, so a
-- forged one fails here, not at the first policy.
CREATE FUNCTION "kernel"."set_context"(p_token text) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.ctx', coalesce(p_token, ''), true);
    PERFORM kernel.ctx();
END;
$$;
--> statement-breakpoint
-- What the policies and the functions read (invoker functions: they only call the verifying one).
CREATE FUNCTION "kernel"."ctx_region"() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
    AS 'SELECT (kernel.ctx()).region_id';
--> statement-breakpoint
CREATE FUNCTION "kernel"."ctx_scope"() RETURNS public.ltree LANGUAGE sql STABLE PARALLEL SAFE
    AS 'SELECT (kernel.ctx()).scope_path';
--> statement-breakpoint
CREATE FUNCTION "kernel"."ctx_party"() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
    AS 'SELECT (kernel.ctx()).party_id';
--> statement-breakpoint
CREATE FUNCTION "kernel"."ctx_user"() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
    AS 'SELECT (kernel.ctx()).user_id';
--> statement-breakpoint
CREATE FUNCTION "kernel"."ctx_unit"() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
    AS 'SELECT (kernel.ctx()).unit_id';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."ctx"(), "kernel"."set_context"(text), "kernel"."ctx_region"(), "kernel"."ctx_scope"(),
    "kernel"."ctx_party"(), "kernel"."ctx_user"(), "kernel"."ctx_unit"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."ctx"(), "kernel"."set_context"(text), "kernel"."ctx_region"(),
    "kernel"."ctx_scope"(), "kernel"."ctx_party"(), "kernel"."ctx_user"(), "kernel"."ctx_unit"()
    TO itrms_app, itrms_system;
--> statement-breakpoint
-- The policies (drizzle/0006) read the verified context, once per query (an initplan), instead of plain settings.
CREATE OR REPLACE FUNCTION "kernel"."apply_rls"(tbl regclass, cls text, col text) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    region constant text := '(region_id = (SELECT kernel.ctx_region()))';
    scope constant text := '(SELECT kernel.ctx_scope())';
    party constant text := '(SELECT kernel.ctx_party())';
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
-- every table gets its policies again (apply_rls writes the list it loops over, so it is read first)
DO $$
DECLARE
    tables constant jsonb := (SELECT jsonb_agg(jsonb_build_object('t', r.table_name::text, 'c', r.class, 'col', r.column_name))
                                FROM kernel.rls_tables r);
    t jsonb;
BEGIN
    FOR t IN SELECT x FROM jsonb_array_elements(tables) AS x LOOP
        PERFORM kernel.apply_rls((t ->> 't')::regclass, t ->> 'c', t ->> 'col');
    END LOOP;
END;
$$;
--> statement-breakpoint
-- The functions that read the caller's context (each one's latest body, now reading the verified context).
CREATE OR REPLACE FUNCTION "kernel"."set_my_preferences"(p_changes jsonb) RETURNS jsonb
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    WITH me AS (
        SELECT u.id, u.preferences FROM kernel.users u
         WHERE u.id = kernel.ctx_user() AND u.active
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
CREATE OR REPLACE FUNCTION "kernel"."ensure_region_data_key"(p_id uuid, p_kek_id text, p_wrapped bytea) RETURNS uuid
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c constant kernel.request_context := kernel.ctx();
    region constant uuid := c.region_id;
    actor constant uuid := c.user_id;
    active_id uuid;
BEGIN
    IF region IS NULL THEN
        RAISE EXCEPTION 'ensure_region_data_key: no region in the context' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT k.id INTO active_id FROM kernel.region_data_keys k WHERE k.region_id = region AND k.active;
    IF active_id IS NOT NULL THEN
        RETURN active_id;
    END IF;
    -- a concurrent first key wins; this one is then dropped
    INSERT INTO kernel.region_data_keys (id, region_id, kek_id, wrapped, created_by, updated_by)
        VALUES (p_id, region, p_kek_id, p_wrapped, actor, actor)
        ON CONFLICT (region_id) WHERE active DO NOTHING;
    SELECT k.id INTO active_id FROM kernel.region_data_keys k WHERE k.region_id = region AND k.active;
    IF active_id = p_id THEN
        INSERT INTO kernel.audit_log (id, action, event_type, table_name, row_id, diff, actor_id, unit_id, region_id,
                                      org_path, request_id, ip)
        VALUES (gen_random_uuid(), 'event', 'crypto.data_key_created', 'kernel.region_data_keys', p_id,
                jsonb_build_object('kekId', p_kek_id), actor,
                c.unit_id, region,
                c.scope_path,
                c.request_id,
                c.ip);
    END IF;
    RETURN active_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kernel"."region_units"(p_ids uuid[])
    RETURNS TABLE (id uuid, code text, name jsonb)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u.id, u.code, to_jsonb(u.name)
      FROM kernel.org_units u
     WHERE u.id = ANY (p_ids[1:200])
       AND u.region_id = kernel.ctx_region()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "parties"."search_persons"(p_query text, p_fin bytea, p_phone bytea, p_limit integer)
    RETURNS TABLE (person_id uuid)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := kernel.ctx_region();
    lim constant integer := least(greatest(coalesce(p_limit, 20), 1), 50);
    query text;
BEGIN
    IF region IS NULL THEN
        RETURN;
    END IF;
    IF p_fin IS NOT NULL THEN
        RETURN QUERY SELECT s.person_id FROM parties.person_sensitive s
                      WHERE s.region_id = region AND s.fin_bidx = p_fin ORDER BY s.merged, s.person_id LIMIT lim;
    ELSIF p_phone IS NOT NULL THEN
        RETURN QUERY SELECT s.person_id FROM parties.person_sensitive s
                      WHERE s.region_id = region AND s.phone_bidx = p_phone ORDER BY s.merged, s.person_id LIMIT lim;
    ELSIF length(btrim(coalesce(p_query, ''))) >= 2 THEN
        query := parties.person_search_sql(region, p_query, lim);
        IF query IS NOT NULL THEN
            RETURN QUERY EXECUTE query;
        END IF;
    END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "parties"."search_organisations"(p_query text, p_limit integer)
    RETURNS TABLE (organisation_id uuid)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := kernel.ctx_region();
    lim constant integer := least(greatest(coalesce(p_limit, 20), 1), 50);
    words text[] := (SELECT array_agg(w) FROM regexp_split_to_table(btrim(left(coalesce(p_query, ''), 100)), '\s+') w
                      WHERE w <> '');
    conditions text := '';
    w text;
BEGIN
    IF region IS NULL OR words IS NULL OR array_length(words, 1) > 6 THEN
        RETURN;
    END IF;
    -- a TIN finds its organisation exactly
    IF array_length(words, 1) = 1 AND words[1] ~ '^[0-9]{10}$' THEN
        RETURN QUERY SELECT o.id FROM parties.organisations o WHERE o.region_id = region AND o.tin = words[1];
        RETURN;
    END IF;
    FOREACH w IN ARRAY words LOOP
        conditions := conditions || format(' AND o.search_text LIKE %L',
            '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    END LOOP;
    RETURN QUERY EXECUTE format(
        'SELECT c.id FROM (SELECT o.id, o.search_text FROM parties.organisations o WHERE o.region_id = %L%s LIMIT 1000) c '
            || 'ORDER BY public.similarity(c.search_text, %L) DESC, c.id LIMIT %s',
        region, conditions, btrim(p_query), lim);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow"."role_holders"(p_unit uuid, p_role text)
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
       -- an office (or one above it) switched off has nobody who can act there (as kernel.resolve_principal)
       AND NOT EXISTS (SELECT 1 FROM kernel.org_units a WHERE a.path @> u.path AND NOT a.active)
       AND u.region_id = kernel.ctx_region()
       AND (u.path @> kernel.ctx_scope()
            OR u.path <@ kernel.ctx_scope())
     LIMIT 500
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow"."open_task"(
    p_id uuid, p_case uuid, p_state text, p_unit uuid, p_role text, p_routed_from uuid, p_due timestamptz
)
    RETURNS void
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    ctx kernel.request_context := kernel.ctx();
    v_region uuid := ctx.region_id;
    v_scope ltree := ctx.scope_path;
    v_user uuid := ctx.user_id;
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
    -- a due time is the step's SLA from now: never already past (it would escalate at once)
    IF p_due IS NOT NULL AND p_due <= now() THEN
        RAISE EXCEPTION 'workflow.open_task: a due time in the past' USING ERRCODE = 'check_violation';
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
CREATE OR REPLACE FUNCTION "kernel"."my_notifications"(p_limit integer, p_before timestamptz)
    RETURNS TABLE (id uuid, unit_id uuid, message_key text, params jsonb, link jsonb, read_at timestamptz,
                   created_at timestamptz)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT n.id, n.unit_id, n.message_key, n.params, n.link, n.read_at, n.created_at
      FROM kernel.notifications n
     WHERE n.user_id = kernel.ctx_user()
       AND n.region_id = kernel.ctx_region()
       AND (p_before IS NULL OR n.created_at < p_before)
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kernel"."read_my_notifications"(p_ids uuid[])
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
           AND n.user_id = kernel.ctx_user()
           AND n.region_id = kernel.ctx_region()
           AND n.read_at IS NULL
        RETURNING 1
    )
    SELECT count(*)::integer FROM marked
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow"."case_people"(p_case uuid, p_q text, p_ids uuid[], p_roles text[])
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
       AND c.region_id = kernel.ctx_region()
       AND c.org_path <@ kernel.ctx_scope()
       AND ra.role_key = ANY (p_roles)
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
CREATE OR REPLACE FUNCTION "forms"."approved_versions"(p_ids uuid[])
    RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    WITH asked AS (
        SELECT v.id, v.form_id, coalesce(v.base_version_id, v.id) AS base_id, v.overlay_version_ids
          FROM forms.form_versions v
         WHERE v.id = ANY (p_ids[1:200])
           AND v.region_id = kernel.ctx_region()
    )
    SELECT a.id
      FROM asked a
      JOIN forms.form_definitions d ON d.id = a.form_id
     WHERE (d.published_version_id = a.base_id
            OR EXISTS (SELECT 1 FROM forms.form_publications p
                        WHERE p.form_version_id = a.base_id AND p.overlay_id IS NULL AND p.status = 'approved'))
       AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(a.overlay_version_ids, '{}'::uuid[])) AS ov(id)
             WHERE NOT EXISTS (SELECT 1 FROM forms.form_overlays o WHERE o.published_version_id = ov.id)
               AND NOT EXISTS (SELECT 1 FROM forms.form_publications p
                                WHERE p.overlay_version_id = ov.id AND p.status = 'approved'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "fees"."slip_in_use"(p_bank text, p_norm text, p_first date, p_last date) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_region constant uuid := kernel.ctx_region();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_region::text || '|' || p_bank || '|' || p_norm, 0));
    RETURN EXISTS (
        SELECT 1 FROM fees.payments p
         WHERE p.region_id = v_region AND p.method = 'bank_slip' AND p.voided_at IS NULL
           AND p.bank_code = p_bank AND ltrim(p.slip_reference_norm, '0') = ltrim(p_norm, '0')
           AND p.slip_date BETWEEN p_first AND p_last);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "fees"."external_reference_in_use"(p_issuer text, p_norm text, p_year integer) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_region constant uuid := kernel.ctx_region();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_region::text || '|' || p_issuer || '|' || p_norm, 0));
    RETURN EXISTS (
        SELECT 1 FROM fees.external_payment_refs r
         WHERE r.region_id = v_region AND r.state IN ('pending_verification', 'verified')
           AND r.issuer = p_issuer AND r.reference_norm = p_norm AND r.fiscal_year = p_year);
END;
$$;
--> statement-breakpoint
-- Follow-up 69: the caller is the verified context's, not an argument. The authenticator signs {sub} before it knows the
-- user, and resolve_principal answers for that subject; my_units answers for the verified user.
DROP FUNCTION "kernel"."resolve_principal"(text, uuid);
--> statement-breakpoint
DROP FUNCTION "kernel"."principal_units"(text);
--> statement-breakpoint
-- The caller acting for a unit: their roles there (assignments open now, in a unit that is active with every unit above
-- it), or no row. Without a unit, the unit of their oldest open assignment.
CREATE FUNCTION "kernel"."resolve_principal"(p_unit uuid)
    RETURNS TABLE (user_id uuid, unit_id uuid, region_id uuid, scope_path text, roles text[])
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    WITH caller AS (
        SELECT u.id FROM kernel.users u WHERE u.keycloak_sub = (kernel.ctx()).subject AND u.active
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
CREATE FUNCTION "kernel"."my_units"()
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
     WHERE u.id = (kernel.ctx()).user_id AND u.active
       AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
       AND NOT EXISTS (SELECT 1 FROM kernel.org_units a WHERE a.path @> ou.path AND NOT a.active)
     GROUP BY ou.id, ou.code, ou.name, ou.path
     ORDER BY ou.path
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."resolve_principal"(uuid), "kernel"."my_units"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."resolve_principal"(uuid), "kernel"."my_units"() TO itrms_app;
--> statement-breakpoint
-- Follow-up 62: the event before a unit is known (a refused sign-in) takes the actor, the request and the address from the
-- verified context, not from arguments, so the API (or an injection as it) cannot write an event naming someone else. The
-- refused subject is the context's.
DROP FUNCTION "kernel"."record_context_free_event"(text, jsonb, uuid, text, text);
--> statement-breakpoint
CREATE FUNCTION "kernel"."record_context_free_event"(event_type text, data jsonb)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c constant kernel.request_context := kernel.ctx();
BEGIN
    IF event_type !~ '^(access|auth).[a-z_.]{1,60}$' THEN
        RAISE EXCEPTION 'record_context_free_event: % is not an access or auth event', event_type;
    END IF;
    INSERT INTO kernel.audit_log (id, action, event_type, diff, actor_id, request_id, ip)
    VALUES (gen_random_uuid(), 'event', event_type,
            -- the refused subject is the verified context's: one passed in the data is dropped
            CASE WHEN c.subject IS NULL THEN coalesce(data, '{}'::jsonb) - 'subject'
                 ELSE (coalesce(data, '{}'::jsonb) - 'subject') || jsonb_build_object('subject', c.subject) END,
            c.user_id, c.request_id, c.ip);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."record_context_free_event"(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."record_context_free_event"(text, jsonb) TO itrms_app;
--> statement-breakpoint
-- A row the API writes to the audit log names the verified context's actor, unit, region, scope, request and address,
-- whatever the statement said (a raw INSERT as itrms_app cannot attribute an act to someone else). The owner's functions
-- and the system role (which acts for a unit's record, actFor) keep what they wrote.
CREATE FUNCTION "kernel"."audit_log_from_context"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    c kernel.request_context;
BEGIN
    IF current_user = 'itrms_app' THEN
        c := kernel.ctx();
        NEW.actor_id := c.user_id;
        NEW.unit_id := c.unit_id;
        NEW.region_id := c.region_id;
        NEW.org_path := c.scope_path;
        NEW.request_id := c.request_id;
        NEW.ip := c.ip;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_from_context" BEFORE INSERT ON "kernel"."audit_log"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."audit_log_from_context"();
