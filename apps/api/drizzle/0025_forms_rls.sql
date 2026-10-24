-- Forms (task 0.16a), hand-written: scope triggers, checks, the keys that tie a version to its form, grants, RLS, and the
-- immutability of versions. Classes: definitions and versions C (the owner unit's subtree writes; it and its ancestors'
-- subtrees read, so a woreda fills in the bureau's forms), publications and submissions T (the unit's subtree).
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_definitions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_publications"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."submissions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
-- the size limits are the API's (MAX_DOCUMENT_BYTES, MAX_ANSWERS_BYTES) with room for jsonb's own encoding
ALTER TABLE "forms"."form_definitions"
    ADD CONSTRAINT "form_definitions_key_check" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("key") BETWEEN 2 AND 80),
    ADD CONSTRAINT "form_definitions_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 4096),
    ADD CONSTRAINT "form_definitions_category_check" CHECK (coalesce(length("category"), 1) BETWEEN 1 AND 100),
    ADD CONSTRAINT "form_definitions_document_check" CHECK (
        jsonb_typeof("document") IN ('object', 'array') AND pg_column_size("document") <= 4194304),
    ADD CONSTRAINT "form_definitions_hash_check" CHECK ("document_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "form_definitions_published_check" CHECK (("published_version_id" IS NULL) = ("published_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "forms"."form_versions"
    ADD CONSTRAINT "form_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "form_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "form_versions_document_check" CHECK (
        jsonb_typeof("document") IN ('object', 'array') AND pg_column_size("document") <= 4194304),
    -- the target of the keys below: a version is named together with its form
    ADD CONSTRAINT "form_versions_form_uq" UNIQUE ("id", "form_id");
--> statement-breakpoint
-- the version a form publishes, a publication asks for, and a submission was filled on is a version of that form
ALTER TABLE "forms"."form_definitions"
    ADD CONSTRAINT "form_definitions_published_version_fk" FOREIGN KEY ("published_version_id", "id")
        REFERENCES "forms"."form_versions" ("id", "form_id");
--> statement-breakpoint
ALTER TABLE "forms"."form_publications"
    ADD CONSTRAINT "form_publications_version_fk" FOREIGN KEY ("form_version_id", "form_id")
        REFERENCES "forms"."form_versions" ("id", "form_id"),
    ADD CONSTRAINT "form_publications_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
    ADD CONSTRAINT "form_publications_text_check" CHECK (
        coalesce(length("note"), 1) BETWEEN 1 AND 500 AND coalesce(length("decision_note"), 1) BETWEEN 1 AND 500),
    ADD CONSTRAINT "form_publications_decision_check" CHECK (
        ("status" = 'pending') = ("decided_by" IS NULL AND "decided_at" IS NULL)),
    -- the second person (SEC-AC-6): checked by the API, and here as the last word
    ADD CONSTRAINT "form_publications_four_eyes_check" CHECK ("decided_by" IS NULL OR "decided_by" IS DISTINCT FROM "created_by");
--> statement-breakpoint
ALTER TABLE "forms"."submissions"
    ADD CONSTRAINT "submissions_version_fk" FOREIGN KEY ("form_version_id", "form_id")
        REFERENCES "forms"."form_versions" ("id", "form_id"),
    ADD CONSTRAINT "submissions_answers_check" CHECK (
        jsonb_typeof("answers") = 'object' AND pg_column_size("answers") <= 1048576);
--> statement-breakpoint
-- A version never changes and is never removed, for any role, the owner included: only a unit move may rewrite its
-- org_path (kernel.org_units_move_subtree, through the set_org_path trigger).
CREATE FUNCTION "forms"."form_versions_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'forms.form_versions is immutable: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "form_versions_immutable" BEFORE UPDATE OR DELETE ON "forms"."form_versions"
    FOR EACH ROW EXECUTE FUNCTION "forms"."form_versions_immutable"();
--> statement-breakpoint
CREATE TRIGGER "form_versions_no_truncate" BEFORE TRUNCATE ON "forms"."form_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "forms"."form_versions_immutable"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "forms" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."form_definitions", "forms"."form_versions", "forms"."form_publications",
    "forms"."submissions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "category", "active", "document", "document_hash", "published_version_id", "published_at",
    "updated_at", "updated_by", "row_version")
    ON "forms"."form_definitions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "decided_by", "decided_at", "decision_note", "updated_at", "updated_by", "row_version")
    ON "forms"."form_publications" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_definitions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_versions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_publications', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('forms.submissions', 'transaction', 'org_path');
