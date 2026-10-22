-- The register of people and organisations (task 0.14) and the regions' data keys, hand-written: scope triggers, checks,
-- grants, RLS, and three reviewed SECURITY DEFINER functions, each limited to the caller's region (app.region_id):
--   kernel.ensure_region_data_key  stores a region's first data key (a woreda clerk may be the first to need it)
--   kernel.region_units            names and codes of units of the caller's region (a register shows the handling unit
--                                  and the address of a record from any unit of the region; org_units' own RLS shows a
--                                  unit only its subtree and ancestors)
--   parties.search_persons         the name search on the trigram index, and the blind-index lookups (FIN, phone)
--   parties.search_organisations   the organisations' name and TIN search
-- They return ids and labels only: the records themselves are then read under RLS.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."region_data_keys"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('region_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "parties"."persons"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "parties"."person_sensitive"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "parties"."organisations"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "parties"."organisation_members"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "parties"."person_merges"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "parties"."persons"
    ADD CONSTRAINT "persons_merged_into_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "parties"."persons"("id"),
    ADD CONSTRAINT "persons_sex_check" CHECK ("sex" IN ('female', 'male')),
    ADD CONSTRAINT "persons_status_check" CHECK ("status" IN ('active', 'merged')),
    ADD CONSTRAINT "persons_not_merged_into_itself" CHECK ("merged_into_id" IS DISTINCT FROM "id"),
    ADD CONSTRAINT "persons_names_check" CHECK (
        length("given_name_am") BETWEEN 1 AND 60 AND length("father_name_am") BETWEEN 1 AND 60
        AND coalesce(length("grandfather_name_am"), 1) BETWEEN 1 AND 60
        AND coalesce(length("given_name_en"), 1) BETWEEN 1 AND 60
        AND coalesce(length("father_name_en"), 1) BETWEEN 1 AND 60
        AND coalesce(length("grandfather_name_en"), 1) BETWEEN 1 AND 60
        AND ("given_name_en" IS NULL) = ("father_name_en" IS NULL)
        AND length("search_text") <= 800),
    ADD CONSTRAINT "persons_address_check" CHECK (
        coalesce(length("kebele"), 1) BETWEEN 1 AND 60 AND coalesce(length("house_number"), 1) BETWEEN 1 AND 30
        AND ("address_unit_id" IS NOT NULL OR ("kebele" IS NULL AND "house_number" IS NULL)));
--> statement-breakpoint
-- a ciphertext is version (1) + data key id (16) + iv (12) + tag (16) + the value; an index is an HMAC-SHA-256
ALTER TABLE "parties"."person_sensitive"
    ADD CONSTRAINT "person_sensitive_same_id" CHECK ("id" = "person_id"),
    ADD CONSTRAINT "person_sensitive_ciphertext_check" CHECK (
        coalesce(length("birth_date_ct") BETWEEN 46 AND 100, true)
        AND coalesce(length("phone_ct") BETWEEN 46 AND 100, true)
        AND coalesce(length("fin_ct") BETWEEN 46 AND 100, true)),
    ADD CONSTRAINT "person_sensitive_index_check" CHECK (
        coalesce(length("birth_date_bidx") = 32, true) AND coalesce(length("phone_bidx") = 32, true)
        AND coalesce(length("fin_bidx") = 32, true)
        AND ("birth_date_ct" IS NULL) = ("birth_date_bidx" IS NULL)
        AND ("phone_ct" IS NULL) = ("phone_bidx" IS NULL)
        AND ("fin_ct" IS NULL) = ("fin_bidx" IS NULL));
--> statement-breakpoint
ALTER TABLE "parties"."organisations"
    ADD CONSTRAINT "organisations_kind_check" CHECK ("kind" IN ('association', 'training_school', 'contractor',
        'consultant', 'garage', 'insurer', 'health_facility', 'government_office', 'other')),
    ADD CONSTRAINT "organisations_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 4096),
    ADD CONSTRAINT "organisations_tin_check" CHECK ("tin" ~ '^[0-9]{10}$'),
    ADD CONSTRAINT "organisations_fields_check" CHECK (
        coalesce(length("licence_number"), 1) BETWEEN 1 AND 60
        AND coalesce(length("kebele"), 1) BETWEEN 1 AND 60 AND coalesce(length("house_number"), 1) BETWEEN 1 AND 30
        AND length("search_text") <= 1000);
--> statement-breakpoint
ALTER TABLE "parties"."organisation_members"
    ADD CONSTRAINT "organisation_members_role_check"
        CHECK ("role" IN ('chair', 'secretary', 'treasurer', 'manager', 'owner', 'member')),
    ADD CONSTRAINT "organisation_members_dates_check" CHECK ("until" IS NULL OR "since" IS NULL OR "until" >= "since");
--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_members_open_uq" ON "parties"."organisation_members" ("organisation_id", "person_id", "role")
    WHERE "until" IS NULL;
--> statement-breakpoint
ALTER TABLE "parties"."person_merges"
    ADD CONSTRAINT "person_merges_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
    ADD CONSTRAINT "person_merges_distinct_check" CHECK ("survivor_id" <> "duplicate_id"),
    ADD CONSTRAINT "person_merges_text_check" CHECK (
        length("reason") BETWEEN 10 AND 500 AND coalesce(length("note"), 0) <= 500),
    ADD CONSTRAINT "person_merges_decision_check" CHECK (
        ("status" = 'pending') = ("decided_by" IS NULL AND "decided_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "kernel"."region_data_keys"
    ADD CONSTRAINT "region_data_keys_check" CHECK ("kek_id" ~ '^[A-Za-z0-9_-]{1,32}$' AND length("wrapped") = 60);
--> statement-breakpoint
GRANT USAGE ON SCHEMA "parties" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "parties"."persons", "parties"."person_sensitive", "parties"."organisations",
    "parties"."organisation_members", "parties"."person_merges" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("given_name_am", "father_name_am", "grandfather_name_am", "given_name_en", "father_name_en",
    "grandfather_name_en", "sex", "birth_year", "address_unit_id", "kebele", "house_number", "status", "merged_into_id",
    "search_text", "name_key_am", "name_key_en", "updated_at", "updated_by", "row_version")
    ON "parties"."persons" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("birth_date_ct", "phone_ct", "fin_ct", "birth_date_bidx", "phone_bidx", "fin_bidx", "merged",
    "updated_at", "updated_by", "row_version")
    ON "parties"."person_sensitive" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("kind", "name", "tin", "licence_number", "address_unit_id", "kebele", "house_number", "search_text",
    "updated_at", "updated_by", "row_version")
    ON "parties"."organisations" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("person_id", "role", "since", "until", "updated_at", "updated_by", "row_version")
    ON "parties"."organisation_members" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "decided_by", "decided_at", "note", "updated_at", "updated_by", "row_version")
    ON "parties"."person_merges" TO itrms_app;
--> statement-breakpoint
-- the wrapped data keys: read by the region (useless without the key-encryption key), written only by the function below
GRANT SELECT ON "kernel"."region_data_keys" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.region_data_keys', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('parties.persons', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('parties.person_sensitive', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('parties.organisations', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('parties.organisation_members', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('parties.person_merges', 'transaction', 'org_path');
--> statement-breakpoint
CREATE FUNCTION "kernel"."ensure_region_data_key"(p_id uuid, p_kek_id text, p_wrapped bytea) RETURNS uuid
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := nullif(current_setting('app.region_id', true), '')::uuid;
    actor constant uuid := nullif(current_setting('app.user_id', true), '')::uuid;
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
                nullif(current_setting('app.unit_id', true), '')::uuid, region,
                nullif(current_setting('app.scope_path', true), '')::public.ltree,
                left(nullif(current_setting('app.request_id', true), ''), 64),
                left(nullif(current_setting('app.ip', true), ''), 64));
    END IF;
    RETURN active_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."ensure_region_data_key"(uuid, text, bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."ensure_region_data_key"(uuid, text, bytea) TO itrms_app;
--> statement-breakpoint
CREATE FUNCTION "kernel"."region_units"(p_ids uuid[])
    RETURNS TABLE (id uuid, code text, name jsonb)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u.id, u.code, to_jsonb(u.name)
      FROM kernel.org_units u
     WHERE u.id = ANY (p_ids[1:200])
       AND u.region_id = nullif(current_setting('app.region_id', true), '')::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."region_units"(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."region_units"(uuid[]) TO itrms_app;
--> statement-breakpoint
-- The SQL of a name search in a region (folded words, each a substring: the trigram index serves every LIKE), most similar
-- first. A query that matches very many people (one common name) ranks the first 1000 found: the answer stays fast, and
-- the person types more of the name to narrow it. Built with %L only. The owner's, for the function below and for EXPLAIN
-- in the tests; the API cannot call it.
CREATE FUNCTION "parties"."person_search_sql"(p_region uuid, p_query text, p_limit integer) RETURNS text
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    words text[] := (SELECT array_agg(w) FROM regexp_split_to_table(btrim(left(p_query, 100)), '\s+') w WHERE w <> '');
    conditions text := '';
    w text;
BEGIN
    IF words IS NULL OR array_length(words, 1) > 6 THEN
        RETURN NULL;
    END IF;
    FOREACH w IN ARRAY words LOOP
        conditions := conditions || format(' AND p.search_text LIKE %L',
            '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    END LOOP;
    RETURN format(
        'SELECT c.id FROM (SELECT p.id, p.search_text FROM parties.persons p WHERE p.region_id = %L%s LIMIT 1000) c '
            || 'ORDER BY public.similarity(c.search_text, %L) DESC, c.id LIMIT %s',
        p_region, conditions, btrim(p_query), least(greatest(coalesce(p_limit, 20), 1), 50));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "parties"."person_search_sql"(uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint
-- p_query: the words folded by the API (foldForSearch); p_fin, p_phone: blind indexes. One of them.
CREATE FUNCTION "parties"."search_persons"(p_query text, p_fin bytea, p_phone bytea, p_limit integer)
    RETURNS TABLE (person_id uuid)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := nullif(current_setting('app.region_id', true), '')::uuid;
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
REVOKE ALL ON FUNCTION "parties"."search_persons"(text, bytea, bytea, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "parties"."search_persons"(text, bytea, bytea, integer) TO itrms_app;
--> statement-breakpoint
CREATE FUNCTION "parties"."search_organisations"(p_query text, p_limit integer)
    RETURNS TABLE (organisation_id uuid)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    region constant uuid := nullif(current_setting('app.region_id', true), '')::uuid;
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
REVOKE ALL ON FUNCTION "parties"."search_organisations"(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "parties"."search_organisations"(text, integer) TO itrms_app;
